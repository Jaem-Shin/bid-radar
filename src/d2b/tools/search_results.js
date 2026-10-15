import { z } from "zod";
import { Budget } from "../../common/client.js";
import { resolveRange } from "../../common/dates.js";
import { val, has, joinLines, sourceFooter, NOT_FOUND } from "../../common/format.js";
import { d2bDate } from "../services.js";
import { scanWindows, orntMatch, sortByDesc, d2bResultLink, D2B_NOTE } from "../lib.js";

export default {
  name: "d2b_search_results",
  title: "D2B 시설 입찰결과 검색",
  description:
    "D2B 시설 경쟁입찰결과(개찰 결과)를 개찰일 기준으로 검색한다. 공사명은 API에서, 발주기관명은 받아온 목록에서 거른다. 기본 최근 30일, 최대 12개월. " +
    "낙찰업체·순위·복수예비가격은 공고번호로 d2b_bid_result에서 본다.",
  inputSchema: {
    keyword: z.string().optional().describe("공사명 일부"),
    institution: z.string().optional().describe("발주기관명 일부"),
    from: z.string().optional().describe("개찰일 시작 YYYY-MM-DD"),
    to: z.string().optional().describe("개찰일 끝 YYYY-MM-DD (기본 오늘)"),
    limit: z.coerce.number().int().min(1).max(300).optional().describe("표시 최대 건수. 기본 30"),
  },
  async run(a) {
    const limit = a.limit || 30;
    const { start, end, windows } = resolveRange(a.from, a.to, { defaultDays: 30, maxMonths: 12 });
    const budget = new Budget(60);
    const r = await scanWindows({
      opKey: "resultList", windows, budget, limit, keep: (it) => orntMatch(it, a.institution),
      params: { cntrwkNm: a.keyword },
      dateParams: (w) => ({ opengDateBegin: d2bDate(w.bgn.slice(0, 8)), opengDateEnd: d2bDate(w.end.slice(0, 8)) }),
    });
    const rows = sortByDesc(r.rows, "opengDt").slice(0, limit);
    const body = rows.map((it) => joinLines([
      `■ ${val(it.cntrwkNm)} — ${val(it.bidResult) || "결과 미표기"}`,
      `  공고번호 ${val(it.pblancNo)}-${val(it.pblancOdr) || "?"}${has(it.pblancSe) ? ` · ${val(it.pblancSe)}` : ""} · 공사번호 ${val(it.cntrwkNo) || "-"}`,
      `  발주기관 ${val(it.ornt) || "-"}${has(it.orntCode) ? ` (${val(it.orntCode)})` : ""} · 개찰 ${val(it.opengDt) || val(it.opengDate) || "-"}`,
      `  ${[val(it.cntrctMth), val(it.bidMth), val(it.sucbidrDecsnMth)].filter(Boolean).join(" · ")}`,
      d2bResultLink(it) ? `  ${d2bResultLink(it)}` : null,
    ]));
    return joinLines([
      `[D2B 시설 입찰결과] 개찰 ${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6)} ~ ${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6)}${a.keyword ? ` · 공사명 '${a.keyword}'` : ""}${a.institution ? ` · 발주기관 '${a.institution}'` : ""}`,
      `API 집계 ${r.apiTotal}건 · 받은 ${r.fetched}건 · 조건 일치 ${r.rows.length}건 · 표시 ${rows.length}건`,
      r.errors.length ? `⚠ 일부 기간 조회 실패: ${r.errors.join(" / ")}` : null,
      "",
      rows.length ? body.join("\n\n") : `${NOT_FOUND} 조건에 맞는 입찰결과가 없습니다.`,
      sourceFooter(["result"], [D2B_NOTE]),
    ]);
  },
};
