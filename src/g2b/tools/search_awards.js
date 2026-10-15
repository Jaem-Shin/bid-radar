import { z } from "zod";
import { Budget } from "../../common/client.js";
import { KINDS, resolveKinds } from "../services.js";
import { resolveRange } from "../../common/dates.js";
import { fanSearch, summaryHeader } from "../../common/search.js";
import { val, won, pct, has, num, median, joinLines, sourceFooter, NOT_FOUND, g2bLink } from "../../common/format.js";
import { KIND_ENUM } from "./search_bids.js";

function bizFmt(b) {
  const s = val(b).replace(/\D/g, "");
  return s.length === 10 ? `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5)}` : val(b);
}

export default {
  name: "g2b_search_awards",
  title: "낙찰 결과 검색",
  description:
    "최종낙찰 목록을 조건으로 검색한다(나라장터 검색조건 오퍼레이션). 공고명·기관·업종·지역·추정가격·사업자번호(특정 업체의 낙찰 이력)로 거를 수 있다. " +
    "기본은 최근 30일 개찰일 기준, 최대 12개월. 표시한 건들의 낙찰률 분포(최소·중앙·최대)와 평균 참가업체수를 (계산)으로 덧붙인다 — 표시분 기준이며 전체 통계가 아니다.",
  inputSchema: {
    keyword: z.string().optional().describe("입찰공고명 일부"),
    institution: z.string().optional().describe("공고기관명 일부"),
    demand_institution: z.string().optional().describe("수요기관명 일부"),
    industry: z.string().optional().describe("나라장터 업종명 일부"),
    region: z.string().optional().describe("참가제한지역명 일부"),
    min_price: z.coerce.number().optional().describe("추정가격 하한(원)"),
    max_price: z.coerce.number().optional().describe("추정가격 상한(원)"),
    bizno: z.string().optional().describe("낙찰업체 사업자번호 10자리 — 특정 업체의 낙찰 이력. '우리'라고 하면 설정된 회사 번호 사용"),
    kind: KIND_ENUM.optional().describe("업무구분. 기본 용역"),
    from: z.string().optional().describe("시작일 YYYY-MM-DD"),
    to: z.string().optional().describe("종료일 YYYY-MM-DD (기본 오늘)"),
    date_basis: z.enum(["개찰일", "공고일"]).optional().describe("기간 기준. 기본 개찰일"),
    limit: z.coerce.number().int().min(1).max(300).optional().describe("표시 최대 건수. 기본 30"),
  },
  async run(a, ctx) {
    const kinds = resolveKinds(a.kind || "용역");
    const { start, end, windows } = resolveRange(a.from, a.to, { defaultDays: 30, maxMonths: 12 });
    const basis = a.date_basis || "개찰일";
    const limit = a.limit || 30;
    let bizno = a.bizno;
    if (bizno && /우리|자사/.test(bizno)) bizno = ctx.config.myBizno;
    bizno = bizno ? String(bizno).replace(/\D/g, "") : undefined;
    if (a.bizno && (!bizno || bizno.length !== 10)) return "[ERROR] 사업자번호는 10자리 숫자여야 합니다(회사 번호를 쓰려면 설정에 사업자번호를 입력하세요).";
    const budget = new Budget(80);
    const r = await fanSearch({
      service: "award",
      opFor: (k) => `getScsbidListSttus${KINDS[k].suffix}PPSSrch`,
      params: {
        inqryDiv: basis === "공고일" ? 1 : 2,
        bidNtceNm: a.keyword,
        ntceInsttNm: a.institution,
        dminsttNm: a.demand_institution,
        indstrytyNm: a.industry,
        prtcptLmtRgnNm: a.region,
        presmptPrceBgn: a.min_price,
        presmptPrceEnd: a.max_price,
        bizno,
      },
      kinds,
      windows,
      limit,
      budget,
    });
    const header = summaryHeader({ title: "낙찰 결과 검색", start, end, basis, total: r.total, shown: r.rows.length, perKind: r.perKind, errors: r.errors });
    const cond = bizno ? `업체 사업자번호 ${bizFmt(bizno)}` : "";
    if (!r.rows.length) {
      return joinLines([header, cond, "", `${NOT_FOUND} 조건에 맞는 낙찰 결과가 API에 없습니다.`, sourceFooter(["award"])]);
    }
    const myBiz = (ctx.config.myBizno || "").replace(/\D/g, "");
    const rows = r.rows.sort((x, y) => val(y.item.rlOpengDt).localeCompare(val(x.item.rlOpengDt)));
    const body = rows.map(({ kind, item: it }) => {
      const ours = myBiz && val(it.bidwinnrBizno).replace(/\D/g, "") === myBiz ? " ★ 우리 회사" : "";
      return joinLines([
        `■ [${kind}] ${val(it.bidNtceNm)}`,
        `  공고번호 ${val(it.bidNtceNo)}-${val(it.bidNtceOrd) || "000"} · 수요기관 ${val(it.dminsttNm) || "-"}`,
        `  개찰 ${val(it.rlOpengDt) || "-"} · 참가 ${val(it.prtcptCnum) || "-"}개사`,
        `  낙찰 ${val(it.bidwinnrNm) || "-"}${has(it.bidwinnrBizno) ? ` (${bizFmt(it.bidwinnrBizno)})` : ""}${ours} · ${won(it.sucsfbidAmt) || "-"} · 낙찰률 ${pct(it.sucsfbidRate) || "-"}`,
        `  ${g2bLink(val(it.bidNtceNo), val(it.bidNtceOrd))}`,
      ]);
    });
    const rates = rows.map((x) => num(x.item.sucsfbidRate)).filter((x) => x != null && x > 0);
    const cnums = rows.map((x) => num(x.item.prtcptCnum)).filter((x) => x != null);
    const stats = rates.length
      ? `\n◆ 표시된 ${rows.length}건 요약 (계산)\n  낙찰률 최소 ${Math.min(...rates).toFixed(3)}% · 중앙값 ${median(rates).toFixed(3)}% · 최대 ${Math.max(...rates).toFixed(3)}% (낙찰률 있는 ${rates.length}건)` +
        (cnums.length ? `\n  평균 참가업체수 ${(cnums.reduce((p, c) => p + c, 0) / cnums.length).toFixed(1)}개사` : "") +
        (r.truncated ? "\n  ※ API 집계 전체가 아니라 표시분 기준입니다." : "")
      : "";
    return joinLines([header, cond, "", body.join("\n\n"), stats, sourceFooter(["award"])]);
  },
};
