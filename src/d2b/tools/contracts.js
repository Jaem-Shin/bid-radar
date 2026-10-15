import { z } from "zod";
import { Budget } from "../../common/client.js";
import { resolveRange } from "../../common/dates.js";
import { val, won, wonPlain, pct, has, num, joinLines, sourceFooter, NOT_FOUND } from "../../common/format.js";
import { d2bDate } from "../services.js";
import { scanWindows, orntMatch, sortByDesc, D2B_NOTE } from "../lib.js";

// 장기계속계약: 총부기금액이 이번 계약금액보다 크면(실측) — 그때만 차수를 보여준다(단년 계약도 차수 1로 옴)
function longTerm(it) {
  const t = num(it.cntrctTotlCsrtBokpAmnt), a = num(it.cntrctAmnt);
  return t != null && a != null && t > a;
}

export function contractBlock(it) {
  return joinLines([
    `■ ${val(it.cntrctNm)}${has(it.cntrctSttus) ? ` — ${val(it.cntrctSttus)}` : ""}`,
    `  계약번호 ${val(it.cntrctNo) || "-"} · 공사번호 ${val(it.cntrwkNo) || "-"} · 계약일 ${val(it.cntrctDate) || "-"}`,
    `  발주기관 ${val(it.ornt) || "-"} · ${[val(it.cntrctDivs), val(it.csrtDivs)].filter(Boolean).join(" · ") || "-"} · ${[val(it.cntrctMth), val(it.bidMth)].filter(Boolean).join(" · ")}`,
    `  계약업체 ${val(it.cntrctEntrpsNm) || "-"} · 계약금액 ${won(it.cntrctAmnt) || "-"}${longTerm(it) ? " (이번 차수분)" : ""}`,
    `  ${[num(it.cntrctSccsBidAmnt) ? `낙찰금액 ${won(it.cntrctSccsBidAmnt)}` : "", num(it.cntrctPlanaAmnt) ? `예정가격 ${won(it.cntrctPlanaAmnt)}` : "", has(it.cntrctBidnRate) ? `낙찰률 ${pct(it.cntrctBidnRate)}` : ""].filter(Boolean).join(" · ") || "낙찰금액·예정가격 API 결과 없음"}`,
    has(it.cntrctContStdt) || has(it.cntrctContCldt) ? `  계약기간 ${val(it.cntrctContStdt) || "?"} ~ ${val(it.cntrctContCldt) || "?"}${longTerm(it) ? ` · 장기계속 ${val(it.cntrctLtmDegr) || "?"}차 (총부기금액 ${wonPlain(it.cntrctTotlCsrtBokpAmnt)})` : ""}` : null,
  ]);
}

export default {
  name: "d2b_contracts",
  title: "D2B 시설 계약정보",
  description:
    "D2B 시설 계약정보를 계약일 기준으로 검색한다: 계약업체·계약금액·예정가격·낙찰률·계약기간·장기계속 차수. 계약명은 API에서, 발주기관명·업무구분은 받아온 목록에서 거른다. 기본 최근 30일, 최대 12개월.",
  inputSchema: {
    keyword: z.string().optional().describe("계약명 일부"),
    institution: z.string().optional().describe("발주기관명 일부"),
    busi: z.string().optional().describe("업무구분 일부 (예: 용역, 공사)"),
    company: z.string().optional().describe("계약업체명 일부 — 받아온 목록에서 거름"),
    from: z.string().optional().describe("계약일 시작 YYYY-MM-DD"),
    to: z.string().optional().describe("계약일 끝 YYYY-MM-DD (기본 오늘)"),
    limit: z.coerce.number().int().min(1).max(300).optional().describe("표시 최대 건수. 기본 30"),
  },
  async run(a) {
    const limit = a.limit || 30;
    const { start, end, windows } = resolveRange(a.from, a.to, { defaultDays: 30, maxMonths: 12 });
    const budget = new Budget(60);
    const keep = (it) => orntMatch(it, a.institution) && (!a.busi || val(it.cntrctDivs).includes(a.busi) || val(it.csrtDivs).includes(a.busi)) && (!a.company || val(it.cntrctEntrpsNm).replace(/\s/g, "").includes(a.company.replace(/\s/g, "")));
    const r = await scanWindows({
      opKey: "contractList", windows, budget, limit: a.company ? 1e9 : limit, keep,
      params: { cntrctNm: a.keyword },
      dateParams: (w) => ({ cntrctDateBegin: d2bDate(w.bgn.slice(0, 8)), cntrctDateEnd: d2bDate(w.end.slice(0, 8)) }),
    });
    const rows = sortByDesc(r.rows, "cntrctDate").slice(0, limit);
    return joinLines([
      `[D2B 시설 계약정보] 계약일 ${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6)} ~ ${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6)}`,
      `API 집계 ${r.apiTotal}건 · 받은 ${r.fetched}건 · 조건 일치 ${r.rows.length}건 · 표시 ${rows.length}건`,
      r.errors.length ? `⚠ 일부 기간 조회 실패: ${r.errors.join(" / ")}` : null,
      "",
      rows.length ? rows.map(contractBlock).join("\n\n") : `${NOT_FOUND} 조건에 맞는 계약이 없습니다.`,
      sourceFooter(["contract"], [D2B_NOTE]),
    ]);
  },
};
