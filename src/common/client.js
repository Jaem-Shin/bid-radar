// data.go.kr OpenAPI 호출 계층 — 모든 도구가 이것만 통해 API를 부른다(JSON·XML 응답 모두 처리).
// 원칙: 응답을 해석할 수 없으면 추측하지 않고 오류로 올린다.

import { HOST, getService } from "./registry.js";
import { ApiError, errorFromCode } from "./errors.js";
import { parseXml } from "./xml.js";

const TIMEOUT_MS = 20_000;
const PAGE_SIZE = 100; // data.go.kr 공통 상한으로 운용(명세상 numOfRows 4자리). 실측 시 재확인.
const CACHE_TTL_MS = 5 * 60_000;

let serviceKey = "";
let fetchImpl = (...a) => fetch(...a);
const cache = new Map();

export function configureClient({ key, fetch: f } = {}) {
  if (key !== undefined) serviceKey = normalizeKey(key);
  if (f) fetchImpl = f;
  cache.clear();
}

// 포털의 'Encoding' 키(%2B 등 포함)를 넣은 경우 한 번 풀어 이중 인코딩을 막는다.
export function normalizeKey(k) {
  const t = String(k || "").trim();
  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try { return decodeURIComponent(t); } catch { return t; }
  }
  return t;
}

export function hasKey() {
  return serviceKey.length > 0;
}

// 호출 수 집계 — 도구 하나가 한도를 과하게 쓰지 않도록.
export class Budget {
  constructor(max) { this.max = max; this.used = 0; }
  take() {
    if (this.used >= this.max) {
      throw new ApiError("", `이 요청은 API 호출 상한(${this.max}회)에 도달해 중단했습니다. 조회 기간이나 조건을 좁혀 주세요.`, { kind: "range" });
    }
    this.used += 1;
  }
}

function buildUrl(service, op, params) {
  const svc = getService(service);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...(svc.params || {}), ...(params || {}) })) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  const shown = `${HOST}${svc.path}/${op}?${qs.toString()}`;
  qs.set("serviceKey", serviceKey);
  return { url: `${HOST}${svc.path}/${op}?${qs.toString()}`, cacheKey: shown };
}

// data.go.kr 봉투 변형(배열·items.item 중첩·단건 객체·빈 문자열·상세의 body.item)을 배열로 정규화
export function bodyItems(body) {
  if (!body || typeof body !== "object") return [];
  if ("items" in body) return normalizeItems(body.items);
  if ("item" in body) return normalizeItems({ item: body.item });
  return [];
}

export function normalizeItems(items) {
  if (Array.isArray(items)) return items;
  if (items && typeof items === "object") {
    if ("item" in items) {
      const it = items.item;
      if (Array.isArray(it)) return it;
      return it ? [it] : [];
    }
  }
  return [];
}

// JSON 어디에 있든 header.resultCode를 찾는다(예: {"nkoneps.com.response.ResponseError":{header:{...}}})
function findHeader(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return null;
  if (obj.header && typeof obj.header === "object" && "resultCode" in obj.header) return obj.header;
  for (const v of Object.values(obj)) {
    const h = findHeader(v, depth + 1);
    if (h) return h;
  }
  return null;
}

export function parseBody(text, httpStatus = 200) {
  let json;
  const trimmed = String(text).trim().replace(/^\uFEFF/, "");
  if (trimmed.startsWith("<") && /<response[\s>]/.test(trimmed) && /<header[\s>]/.test(trimmed)) {
    json = parseXml(trimmed); // 정상 XML 봉투(D2B 등) — JSON과 같은 모양으로 바꿔 아래에서 처리
  } else try {
    json = JSON.parse(trimmed);
  } catch {
    // 비JSON(XML 오류 봉투) — returnReasonCode 또는 resultCode
    const m = text.match(/<returnReasonCode>\s*(\d+)\s*<\/returnReasonCode>/) || text.match(/<resultCode>\s*(\d+)\s*<\/resultCode>/);
    if (m) {
      const msg = (text.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/) || text.match(/<resultMsg>([^<]*)<\/resultMsg>/) || [])[1] || "";
      if (m[1] === "00" || m[1] === "0") throw new ApiError("", "XML 응답 형태를 해석하지 못했습니다. 해석하지 않고 중단합니다.", { kind: "parse" });
      if (m[1] === "03") return { items: [], total: 0 };
      throw errorFromCode(m[1], msg.trim());
    }
    if (/unauthori[sz]ed/i.test(text) || httpStatus === 401) {
      throw new ApiError("30", "인증 실패(HTTP 401). 인증키가 올바른지, 해당 서비스 활용승인이 났는지 확인하세요.", { kind: "auth", httpStatus });
    }
    throw new ApiError("", `응답을 해석할 수 없습니다: ${text.trim().slice(0, 120)}`, { kind: "parse", httpStatus });
  }
  const header = findHeader(json);
  if (!header) throw new ApiError("", "응답에 결과코드가 없습니다. 해석하지 않고 중단합니다.", { kind: "parse" });
  const code = String(header.resultCode ?? "").trim();
  if (code === "03") return { items: [], total: 0 };
  if (code !== "00" && code !== "0") throw errorFromCode(code, String(header.resultMsg ?? "").trim());
  const body = json.response?.body ?? {};
  const items = bodyItems(body);
  const total = Number(body.totalCount ?? items.length) || 0;
  return { items, total };
}

async function callOnce(url, cacheKey) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res, text;
  try {
    res = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: "application/json, application/xml;q=0.9" } });
    text = await res.text();
  } catch (e) {
    const timeout = e?.name === "AbortError";
    throw new ApiError("", timeout ? `API 응답 시간 초과(${TIMEOUT_MS / 1000}초)` : `네트워크 오류: ${e?.message || e}`, { kind: "network", retryable: true });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok && res.status !== 401) {
    // 본문에 결과코드가 있으면 그걸 우선
    try { parseBody(text, res.status); } catch (e) { if (e instanceof ApiError && e.code) throw e; }
    throw new ApiError("", `API HTTP ${res.status} 오류`, { kind: "network", httpStatus: res.status, retryable: res.status === 429 || res.status >= 500 });
  }
  return parseBody(text, res.status);
}

/**
 * 단일 페이지 호출. budget이 있으면 호출 1회 차감.
 * 반환: { items, total, request } — request는 키를 뺀 요청 URL(검증용)
 */
export async function call(service, op, params, { budget } = {}) {
  if (!hasKey()) throw new ApiError("10", "인증키가 설정되지 않았습니다. 확장 설정 또는 환경변수 DATA_GO_KR_SERVICE_KEY에 공공데이터포털 인증키를 넣으세요.", { kind: "auth" });
  const { url, cacheKey } = buildUrl(service, op, params);
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, request: cacheKey };
  for (let attempt = 0; ; attempt++) {
    budget?.take();
    try {
      const value = await callOnce(url, cacheKey);
      cache.set(cacheKey, { at: Date.now(), value });
      return { ...value, request: cacheKey };
    } catch (e) {
      if (!(e instanceof ApiError) || !e.retryable || attempt >= 1) throw e;
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
    }
  }
}

/**
 * 여러 페이지를 maxRows까지 모은다. truncated=true면 total보다 적게 가져온 것.
 */
export async function callAll(service, op, params, { maxRows = 300, budget } = {}) {
  const first = await call(service, op, { ...params, pageNo: 1, numOfRows: PAGE_SIZE }, { budget });
  const items = [...first.items];
  const total = first.total;
  let page = 1;
  while (items.length < Math.min(total, maxRows) && first.items.length > 0) {
    page += 1;
    const next = await call(service, op, { ...params, pageNo: page, numOfRows: PAGE_SIZE }, { budget });
    if (next.items.length === 0) break;
    items.push(...next.items);
  }
  const kept = items.slice(0, maxRows);
  return { items: kept, total, truncated: total > kept.length, request: first.request };
}

/**
 * 최신 건부터 maxRows까지 모은다. 실측(2026-10-15): 검색조건(PPSSrch) 목록은 오래된 순으로 온다.
 * 그래서 1건 호출로 총건수를 얻고 마지막 페이지부터 거꾸로 읽는다. total이 maxRows 이하면 callAll과 같다.
 */
export async function callLatest(service, op, params, { maxRows = 300, budget } = {}) {
  const head = await call(service, op, { ...params, pageNo: 1, numOfRows: 1 }, { budget });
  const total = head.total;
  if (maxRows <= 0) return { items: [], total, truncated: total > 0, request: head.request }; // 총건수만
  if (total <= maxRows) {
    if (total === 0) return { items: [], total: 0, truncated: false, request: head.request };
    return callAll(service, op, params, { maxRows, budget });
  }
  const lastPage = Math.ceil(total / PAGE_SIZE);
  const items = [];
  for (let page = lastPage; page >= 1 && items.length < maxRows; page--) {
    const r = await call(service, op, { ...params, pageNo: page, numOfRows: PAGE_SIZE }, { budget });
    items.push(...[...r.items].reverse());
  }
  const kept = items.slice(0, maxRows);
  return { items: kept, total, truncated: total > kept.length, request: head.request };
}
