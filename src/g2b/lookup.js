// 공고번호 해석과 업무구분 자동 탐색 — 여러 도구가 공유.

import { call, callAll } from "../common/client.js";
import { KINDS, KIND_NAMES } from "./services.js";
import { val } from "../common/format.js";
import { ApiError } from "../common/errors.js";

/**
 * "R25BK00933736", "R25BK00933736-000", 나라장터 링크(bidPbancNo=...&bidPbancOrd=...),
 * 구 번호체계 11자리(YYYYMM+순번5) 모두 허용.
 */
export function parseBidNo(input, ordInput) {
  const s = String(input || "").trim();
  let no, ord;
  const q = s.match(/bidPbancNo=([A-Za-z0-9]+)/);
  if (q) {
    no = q[1];
    ord = (s.match(/bidPbancOrd=(\d{1,3})/) || [])[1];
  } else {
    const m = s.match(/(R\d{2}[A-Z]{2}\d{8}|\d{11})(?:\s*[-_ ]\s*(\d{1,3}))?/i);
    if (m) { no = m[1].toUpperCase(); ord = m[2]; }
  }
  if (!no) throw new Error(`입찰공고번호를 알아볼 수 없습니다: "${s}" (예: R25BK00933736 또는 R25BK00933736-000)`);
  if (ordInput) ord = String(ordInput);
  return { no, ord: ord ? ord.padStart(3, "0") : undefined };
}

export function execKey(r) {
  return [val(r.bidNtceNo), val(r.bidNtceOrd) || "000", val(r.bidClsfcNo) || "0", val(r.rbidNo) || "000"].join("|");
}

/**
 * 입찰공고정보서비스에서 공고번호로 공고를 찾는다. 업무구분을 모르면 용역→공사→물품→외자 순으로 시도.
 * 반환: { kind, items(해당 공고의 모든 차수), tried, errors }
 */
export async function findNotice(no, { kind, budget } = {}) {
  const order = kind ? [kind] : KIND_NAMES;
  const errors = [];
  for (const k of order) {
    try {
      const r = await callAll("bid", `getBidPblancListInfo${KINDS[k].suffix}`, { inqryDiv: 2, bidNtceNo: no }, { maxRows: 50, budget });
      const items = r.items.filter((x) => val(x.bidNtceNo) === no);
      if (items.length) return { kind: k, items, errors, request: r.request };
    } catch (e) {
      if (e instanceof ApiError && (e.kind === "access" || e.kind === "auth" || e.kind === "quota")) throw e;
      errors.push(`${k}: ${e.message}`);
    }
  }
  return { kind: null, items: [], errors };
}

// 차수 선택: 지정 차수 우선, 없으면 가장 높은 차수
export function pickOrder(items, ord) {
  const sorted = [...items].sort((a, b) => val(b.bidNtceOrd).localeCompare(val(a.bidNtceOrd)));
  if (ord) return { chosen: sorted.find((x) => val(x.bidNtceOrd) === ord) || null, all: sorted };
  return { chosen: sorted[0] || null, all: sorted };
}

export { call };
