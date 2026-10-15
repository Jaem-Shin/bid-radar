// D2B 도구 공통 — 시설 오퍼레이션 호출, 기간 창 순회, 표기
import { z } from "zod";
import { call, callAll, callLatest } from "../common/client.js";
import { ApiError, describeError } from "../common/errors.js";
import { val, has, won, num } from "../common/format.js";
import { OPS } from "./services.js";

export function d2b(opKey, params, opts) {
  const [svc, op] = OPS[opKey];
  return call(svc, op, params, opts);
}
export function d2bAll(opKey, params, opts) {
  const [svc, op] = OPS[opKey];
  return callAll(svc, op, params, opts);
}
// 목록은 오래된 순으로 온다(2026-10-15 실측) → 많을 때는 마지막 페이지부터 읽는다.
export function d2bLatest(opKey, params, opts) {
  const [svc, op] = OPS[opKey];
  return callLatest(svc, op, params, opts);
}

export const FATAL = ["auth", "access", "quota"];

/**
 * 월 단위 창을 최근부터 돌며 목록을 모은다. 창 안에서는 최신 건부터 받고(perWindow까지), 받은 뒤 정렬한다.
 * dateParams(w) → 창별 날짜 파라미터, keep(item) → 클라이언트 쪽 거르기(기관명·업무구분 등)
 */
export async function scanWindows({ opKey, windows, dateParams, params = {}, keep = () => true, limit = 30, perWindow = 300, budget }) {
  const rows = [];
  let apiTotal = 0;
  let fetched = 0;
  let windowTruncated = false;
  const errors = [];
  for (const w of [...windows].reverse()) {
    if (rows.length >= limit) break;
    try {
      const r = await d2bLatest(opKey, { ...params, ...dateParams(w) }, { maxRows: perWindow, budget });
      apiTotal += r.total;
      fetched += r.items.length;
      if (r.truncated) windowTruncated = true;
      rows.push(...r.items.filter(keep));
    } catch (e) {
      if (e instanceof ApiError && FATAL.includes(e.kind)) throw e;
      errors.push(`${w.bgn.slice(0, 8)}~${w.end.slice(0, 8)}: ${describeError(e)}`);
    }
  }
  return { rows, apiTotal, fetched, windowTruncated, errors };
}

export const BUSI_ENUM = z.enum(["용역", "공사", "전체"]);

export function busiMatch(item, busi) {
  if (!busi || busi === "전체") return true;
  return val(item.busiDivs).includes(busi);
}
export function orntMatch(item, institution) {
  if (!institution) return true;
  return val(item.ornt).replace(/\s/g, "").includes(String(institution).replace(/\s/g, ""));
}

// D2B 금액 문자열 "1,234,000" · "1234000" → 원 단위 표기용 원문 유지
export function sortByDesc(rows, key) {
  return rows.sort((a, b) => val(b[key]).localeCompare(val(a[key])));
}

// 취소된 건(취소공고·공개협상취소)인지
export function isCancelled(it) {
  return /취소/.test(val(it.pblancSe)) || /취소/.test(val(it.progrsSttus));
}
// 진행 중인 건을 먼저, 취소된 건은 뒤로(각각 key 내림차순)
export function sortActiveFirst(rows, key) {
  const sorted = sortByDesc([...rows], key);
  return [...sorted.filter((r) => !isCancelled(r)), ...sorted.filter(isCancelled)];
}

// 공고 상태 경고
export function noticeWarn(pblancSe) {
  const s = val(pblancSe);
  if (/취소/.test(s)) return " ⚠ 취소공고";
  if (/정정|연기/.test(s)) return ` (${s})`;
  return "";
}

// 면허/지역 제한 목록 "[코드] 이름^[코드] 이름" → 줄 목록
export function splitList(s) {
  if (!has(s)) return [];
  return String(s).split(/\^|\||,\s*(?=\[)/).map((x) => x.trim()).filter(Boolean); // 구분자 ^ 또는 | (둘 다 실측)
}

export function bizFmt(b) {
  const s = val(b).replace(/\D/g, "");
  return s.length === 10 ? `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5)}` : val(b);
}

// D2B가 주는 나라장터 연계번호(g2bPblancNo)는 연도+기관코드+공고번호+공사번호를 이어 붙인 값으로,
// 나라장터 입찰공고번호 형식이 아니다(2026-10-15 실측, G2B 조회 불가) → '나라장터 공고번호'로 표시하지 않는다.
// 목록은 '2026LHQ0172…', 상세는 'LHQ0172…'처럼 연도가 빠져 온다(실측) → D2B 화면 표기(연도 포함)에 맞춘다
export function g2bLinkNo(it) {
  if (!has(it.g2bPblancNo)) return "";
  let no = val(it.g2bPblancNo);
  const year = val(it.pblancYear) || (val(it.cntrwkNo).match(/^(\d{4})-/) || [])[1];
  if (!/^\d{4}/.test(no) && year) no = year + no;
  return `${no}${has(it.g2bPblancOdr) ? ` (차수 ${val(it.g2bPblancOdr)})` : ""}`;
}

// 0원은 '해당 없음'으로 오는 항목(평가기준금액·토목/건축 기초금액 등) — 표시하지 않는다
export function wonNZ(v) {
  return num(v) ? won(v) : "";
}

// 등록심사 시점 코드(실측: F). 모르는 코드는 코드 그대로 보여준다.
const REGIST_JDGMN = { F: "입찰서 제출마감 후 등록심사(참가등록 때는 심사 없음)" };
export function registJdgmnText(v) {
  const c = val(v);
  if (!c) return "";
  return REGIST_JDGMN[c] || (c.length <= 2 ? `코드 ${c}(원문 확인)` : c);
}

// 공고구분 이름 → 상세 조회용 코드(실측: 정상 A, 긴급 B, 정정 H). 모르면 후보를 차례로 시도.
const PBLANC_SE_CODE = { 정상공고: "A", 긴급공고: "B", 정정공고: "H" };
const SE_CODE_CANDIDATES = ["A", "B", "H", "C", "D", "E", "F", "G", "I", "J", "K", "L"];
/**
 * 마감된 경쟁입찰공고는 목록 API에 없다(목록은 진행 중 공고만, 2026-10-15 실측) → 결과·계약 등에서 얻은 키로 상세를 직접 조회.
 * 반환: 상세 항목(+pblancSeCode·pblancYear 채움) 또는 null
 */
export async function bidDetailByKeys(k, { budget } = {}) {
  const year = val(k.pblancYear) || (val(k.cntrwkNo).match(/^(\d{4})-/) || [])[1];
  if (!year || !has(k.pblancNo) || !has(k.cntrwkNo) || !has(k.orntCode)) return null;
  const known = val(k.pblancSeCode) || PBLANC_SE_CODE[val(k.pblancSe)];
  const codes = known ? [known] : SE_CODE_CANDIDATES;
  for (const code of codes) {
    const r = await d2b("bidDetail", { pblancYear: year, pblancSeCode: code, pblancNo: val(k.pblancNo), pblancOdr: val(k.pblancOdr) || "1", cntrwkNo: val(k.cntrwkNo), orntCode: val(k.orntCode) }, { budget });
    if (r.items[0]) return { ...r.items[0], pblancSeCode: code, pblancYear: year, orntCode: val(k.orntCode) };
  }
  return null;
}

// 공개수의협상은 견적서 마감일 기준 → 끝을 정하지 않으면 마감 전(진행 중) 건이 보이도록 앞으로 30일까지 본다.
export const NEGO_AHEAD_DAYS = 30;

// D2B 원문 바로가기 — 사이트 화면이 쓰는 주소를 2026-10-15에 확인(공식 API 제공값 아님).
// 시설(공사·용역) 경쟁입찰·공개수의 모두 /peb/ 아래. 필요한 값이 하나라도 없으면 링크를 만들지 않는다.
const D2B_BASE = "https://www.d2b.go.kr";
export function d2bBidLink(it) {
  const p = {
    dprt_code: val(it.orntCode), anmt_divs: val(it.pblancSeCode), anmt_numb: val(it.pblancNo), rqst_degr: val(it.pblancOdr),
    dcsn_numb: val(it.cntrwkNo), rqst_year: val(it.pblancYear),
  };
  if (Object.values(p).some((v) => !v)) return "";
  return `${D2B_BASE}/peb/bid/announceView.do?${new URLSearchParams({ ...p, lv1_divs: "PEB", lv2Divs: "1", pageDivs: "E1" })}`;
}
export function d2bNegoLink(it) {
  const cntrwkNo = val(it.cntrwkNo);
  const year = (cntrwkNo.match(/^(\d{4})-/) || [])[1] || val(it.ntatPlanDate).slice(0, 4);
  const p = { dprt_code: val(it.orntCode), anmt_numb: val(it.pblancNo), negn_degr: val(it.pblancOdr), csrt_numb: cntrwkNo, ordr_year: year, negn_pldt: val(it.ntatPlanDate) };
  if (Object.values(p).some((v) => !v)) return "";
  return `${D2B_BASE}/peb/openNego/openNegoPlanView.do?${new URLSearchParams({ ...p, pageDivs: "E", list_url: "/peb/bid/announceList.do" })}`;
}

// 경쟁입찰 결과 상세(실측: benf_pldt=개찰일, csrt_numb=공사번호가 없으면 순위표가 비어 나옴). 계약 상세는 로그인·계약유형 의존이라 만들지 않음.
export function d2bResultLink(it) {
  const cntrwkNo = val(it.cntrwkNo);
  const year = (cntrwkNo.match(/^(\d{4})-/) || [])[1];
  const opengDate = val(it.opengDate) || val(it.opengDt).replace(/\D/g, "").slice(0, 8);
  const p = { ordr_year: year, dprt_code: val(it.orntCode), dcsn_numb: cntrwkNo, csrt_numb: cntrwkNo, benf_pldt: opengDate, anmt_numb: val(it.pblancNo), rqst_degr: val(it.pblancOdr) };
  if (Object.values(p).some((v) => !v)) return "";
  return `${D2B_BASE}/peb/bid/bidResultView.do?${new URLSearchParams({ ...p, benf_degr: p.rqst_degr, lvDivs2: "BID", pageDivs: "E" })}`;
}

export const D2B_NOTE = "※ D2B 원문 링크가 열리지 않으면 국방전자조달시스템(https://www.d2b.go.kr)에서 공고번호로 확인하세요. D2B 페이지를 열 때 보안프로그램(SecuKitNXS) 설치 창이 뜰 수 있는데, 공고·결과 열람만 할 때는 설치하지 않아도 됩니다.";
