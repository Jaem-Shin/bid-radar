import { z } from "zod";
import { Budget } from "../../common/client.js";
import { KINDS, resolveKinds } from "../services.js";
import { resolveRange } from "../../common/dates.js";
import { fanSearch, summaryHeader } from "../../common/search.js";
import { val, won, when, has, g2bLink, sourceFooter, NOT_FOUND, joinLines } from "../../common/format.js";

export const KIND_ENUM = z.enum(["용역", "공사", "물품", "외자", "전체"]);

export function noticeBlock(kind, it) {
  const no = val(it.bidNtceNo);
  const ord = val(it.bidNtceOrd) || "000";
  const status = val(it.ntceKindNm);
  const warn = /취소/.test(status) ? " ⚠ 취소공고" : /변경/.test(status) ? " (변경공고)" : "";
  const inst = [val(it.ntceInsttNm), val(it.dminsttNm) && val(it.dminsttNm) !== val(it.ntceInsttNm) ? `수요 ${val(it.dminsttNm)}` : ""].filter(Boolean).join(" / ");
  const method = [val(it.cntrctCnclsMthdNm), val(it.sucsfbidMthdNm)].filter(Boolean).join(" · ");
  return joinLines([
    `■ [${kind}] ${val(it.bidNtceNm)}${warn}`,
    `  공고번호 ${no}-${ord}${status ? ` · ${status}` : ""}`,
    inst ? `  기관: ${inst}` : null,
    has(it.presmptPrce) || has(it.asignBdgtAmt) ? `  추정가격 ${won(it.presmptPrce) || "-"}${has(it.asignBdgtAmt) ? ` · 배정예산 ${won(it.asignBdgtAmt)}` : ""}` : null,
    method ? `  방식: ${method}` : null,
    `  공고 ${val(it.bidNtceDt) || "-"} · 입찰마감 ${when(it.bidClseDt) || "-"} · 개찰 ${val(it.opengDt) || "-"}`,
    `  ${val(it.bidNtceDtlUrl).replace(/\s+/g, "") || g2bLink(no, ord)}`,
  ]);
}

export default {
  name: "g2b_search_bids",
  title: "입찰공고 검색",
  description:
    "나라장터 입찰공고를 조건으로 검색한다(나라장터 검색조건 오퍼레이션). 공고명·기관명·업종명·지역명은 일부만 입력해도 된다. " +
    "기간은 기본 최근 30일(공고게시일 기준), 1개월 넘는 기간은 자동 분할(최대 12개월). 업무구분 기본값은 용역. " +
    "결과의 공고번호를 g2b_bid_detail에 넘기면 기초금액·면허제한·첨부까지 본다.",
  inputSchema: {
    keyword: z.string().optional().describe("입찰공고명 일부 (예: 설계, 건설사업관리)"),
    institution: z.string().optional().describe("공고기관명 일부 (예: 국방시설본부)"),
    demand_institution: z.string().optional().describe("수요기관명 일부"),
    industry: z.string().optional().describe("나라장터 업종명 일부"),
    region: z.string().optional().describe("참가제한지역명 일부 (예: 서울, 전국)"),
    min_price: z.coerce.number().optional().describe("추정가격 하한(원)"),
    max_price: z.coerce.number().optional().describe("추정가격 상한(원)"),
    kind: KIND_ENUM.optional().describe("업무구분. 기본 용역"),
    from: z.string().optional().describe("시작일 YYYY-MM-DD"),
    to: z.string().optional().describe("종료일 YYYY-MM-DD (기본 오늘)"),
    date_basis: z.enum(["공고일", "개찰일"]).optional().describe("기간 기준. 기본 공고일"),
    limit: z.coerce.number().int().min(1).max(200).optional().describe("표시 최대 건수. 기본 30"),
  },
  async run(a) {
    const kinds = resolveKinds(a.kind || "용역");
    const { start, end, windows } = resolveRange(a.from, a.to, { defaultDays: 30, maxMonths: 12 });
    const basis = a.date_basis || "공고일";
    const limit = a.limit || 30;
    const budget = new Budget(60);
    const r = await fanSearch({
      service: "bid",
      opFor: (k) => `getBidPblancListInfo${KINDS[k].suffix}PPSSrch`,
      params: {
        inqryDiv: basis === "개찰일" ? 2 : 1,
        bidNtceNm: a.keyword,
        ntceInsttNm: a.institution,
        dminsttNm: a.demand_institution,
        indstrytyNm: a.industry,
        prtcptLmtRgnNm: a.region,
        presmptPrceBgn: a.min_price,
        presmptPrceEnd: a.max_price,
      },
      kinds,
      windows,
      limit,
      budget,
    });
    const header = summaryHeader({ title: "입찰공고 검색", start, end, basis, total: r.total, shown: r.rows.length, perKind: r.perKind, errors: r.errors });
    if (!r.rows.length) {
      return joinLines([header, "", `${NOT_FOUND} 조건에 맞는 입찰공고가 API 결과에 없습니다. 조건(키워드·기간·업무구분)을 바꿔 보세요.`, sourceFooter(["bid"])]);
    }
    const sorted = r.rows.sort((x, y) => val(y.item.bidNtceDt).localeCompare(val(x.item.bidNtceDt)));
    return joinLines([header, "", sorted.map((x) => noticeBlock(x.kind, x.item)).join("\n\n"), sourceFooter(["bid"])]);
  },
};
