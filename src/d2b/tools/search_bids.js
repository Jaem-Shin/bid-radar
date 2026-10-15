import { z } from "zod";
import { Budget } from "../../common/client.js";
import { resolveRange, addDays, todayYmd } from "../../common/dates.js";
import { val, won, when, has, joinLines, sourceFooter, NOT_FOUND } from "../../common/format.js";
import { d2bDate } from "../services.js";
import { scanWindows, BUSI_ENUM, busiMatch, orntMatch, sortActiveFirst, isCancelled, noticeWarn, g2bLinkNo, d2bBidLink, d2bNegoLink, NEGO_AHEAD_DAYS, D2B_NOTE } from "../lib.js";

export function bidBlock(it) {
  return joinLines([
    `■ [경쟁·${val(it.busiDivs) || val(it.cntrwkSe) || "?"}] ${val(it.cntrwkNm)}${noticeWarn(it.pblancSe)}`,
    `  공고번호 ${val(it.pblancNo)}-${val(it.pblancOdr) || "?"}${has(it.pblancSe) ? ` · ${val(it.pblancSe)}` : ""} · 공사번호 ${val(it.cntrwkNo) || "-"}`,
    `  발주기관 ${val(it.ornt) || "-"}${has(it.orntCode) ? ` (${val(it.orntCode)})` : ""}`,
    `  방식 ${[val(it.cntrctMth), val(it.bidStle)].filter(Boolean).join(" · ") || "-"}${has(it.baseAmnt) ? ` · 기초예비가격 ${won(it.baseAmnt)}` : has(it.budgetAmount) ? ` · 예산 ${won(it.budgetAmount)}` : ""}`,
    `  공고 ${val(it.pblancDate) || "-"} · 참가등록마감 ${when(it.bidPartcptRegistClosDt) || when(it.bidPartcptReqstClosDt) || "-"} · 입찰서마감 ${when(it.biddocPresentnClosDt) || "-"} · 개찰 ${val(it.opengDt) || "-"}`,
    g2bLinkNo(it) ? `  나라장터 연계번호 ${g2bLinkNo(it)}` : null,
    d2bBidLink(it) ? `  ${d2bBidLink(it)}` : null,
  ]);
}

export function negoBlock(it) {
  return joinLines([
    `■ [공개수의·${val(it.busiDivs) || "?"}] ${val(it.cntrwkNm)}${isCancelled(it) ? " ⚠ 취소" : ""}`,
    `  공고번호 ${val(it.pblancNo)}-${val(it.pblancOdr) || "?"} · 공사번호 ${val(it.cntrwkNo) || "-"}${has(it.progrsSttus) ? ` · ${val(it.progrsSttus)}` : ""}`,
    `  발주기관 ${val(it.ornt) || "-"}${has(it.orntCode) ? ` (${val(it.orntCode)})` : ""}`,
    `  예산 ${won(it.budgetAmount) || "-"}${has(it.baseAmnt) ? ` · 기초예비가격 ${won(it.baseAmnt)}` : ""}${has(it.bidMth) ? ` · ${val(it.bidMth)}` : ""}`,
    `  견적서마감 ${when(it.prqudoPresentnClosDt) || "-"} · 개찰 ${val(it.opengDt) || "-"}${has(it.ntatPlanDate) ? ` · 협상계획일 ${val(it.ntatPlanDate)}` : ""}`,
    d2bNegoLink(it) ? `  ${d2bNegoLink(it)}` : null,
  ]);
}

export default {
  name: "d2b_search_bids",
  title: "D2B 시설 입찰공고 검색",
  description:
    "국방전자조달(D2B) 시설 분야(공사·용역) 입찰공고를 검색한다: 경쟁입찰공고(공고일 기준)와 공개수의협상계획(견적서 마감일 기준). " +
    "공사명은 API에서, 발주기관명·업무구분은 받아온 목록에서 거른다. 기본 최근 30일·용역, 최대 12개월. 공개수의는 종료일을 안 주면 마감 전 건도 보이도록 30일 뒤까지 본다.",
  inputSchema: {
    keyword: z.string().optional().describe("공사명(사업명) 일부 (예: 설계, 감리)"),
    institution: z.string().optional().describe("발주기관명 일부 (예: 국군재정관리단, 군단, 사령부)"),
    busi: BUSI_ENUM.optional().describe("업무구분. 기본 용역"),
    from: z.string().optional().describe("시작일 YYYY-MM-DD"),
    to: z.string().optional().describe("종료일 YYYY-MM-DD (기본 오늘)"),
    include_negotiation: z.boolean().optional().describe("공개수의협상계획 포함(기본 true)"),
    limit: z.coerce.number().int().min(1).max(200).optional().describe("유형별 표시 최대 건수. 기본 30"),
  },
  async run(a) {
    const busi = a.busi || "용역";
    const limit = a.limit || 30;
    const { start, end, windows } = resolveRange(a.from, a.to, { defaultDays: 30, maxMonths: 12 });
    const budget = new Budget(80);
    const keep = (it) => busiMatch(it, busi) && orntMatch(it, a.institution);

    const cmp = await scanWindows({
      opKey: "bidList", windows, budget, limit, keep,
      params: { cntrwkNm: a.keyword },
      dateParams: (w) => ({ anmtDateBegin: d2bDate(w.bgn.slice(0, 8)), anmtDateEnd: d2bDate(w.end.slice(0, 8)) }),
    });
    // 공개수의: 견적서 마감일 기준이라 끝을 안 주면 앞으로 30일까지(진행 중인 건 포함)
    const negoRange = a.to ? { start, end, windows } : resolveRange(a.from || start, addDays(todayYmd(), NEGO_AHEAD_DAYS), { defaultDays: 30, maxMonths: 13 });
    const nego = a.include_negotiation === false ? null : await scanWindows({
      opKey: "negoPlanList", windows: negoRange.windows, budget, limit, keep,
      params: { othbcNtatNm: a.keyword },
      dateParams: (w) => ({ prqudoPresentnClosDateBegin: d2bDate(w.bgn.slice(0, 8)), prqudoPresentnClosDateEnd: d2bDate(w.end.slice(0, 8)) }),
    });

    const fmt = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
    const range = `${fmt(start)} ~ ${fmt(end)}`;
    const filt = [busi !== "전체" ? `업무구분 ${busi}` : "", a.institution ? `발주기관 '${a.institution}'` : "", a.keyword ? `공사명 '${a.keyword}'` : ""].filter(Boolean).join(" · ");
    const section = (title, r, block, sortKey) => {
      if (!r) return null;
      const rows = sortActiveFirst(r.rows, sortKey).slice(0, limit);
      const cancelled = r.rows.filter(isCancelled).length;
      return joinLines([
        `◆ ${title} — 조건 일치 ${r.rows.length}건${r.rows.length > rows.length ? ` 중 ${rows.length}건 표시` : ""} (API 받은 ${r.fetched}건 / 집계 ${r.apiTotal}건${r.windowTruncated ? ", 일부 기간은 최근 건만 받음" : ""})${cancelled ? ` · 취소 ${cancelled}건은 맨 뒤` : ""}`,
        r.errors.length ? `⚠ 일부 기간 조회 실패: ${r.errors.join(" / ")}` : null,
        rows.length ? rows.map(block).join("\n\n") : `${NOT_FOUND} 조건에 맞는 건이 없습니다.`,
      ]);
    };
    return joinLines([
      `[D2B 시설 입찰공고 검색] ${range}${filt ? ` · ${filt}` : ""}`,
      "",
      section("경쟁입찰공고 (공고일 기준)", cmp, bidBlock, "pblancDate"),
      "",
      section(`공개수의협상계획 (견적서 마감일 기준 ${fmt(negoRange.start)} ~ ${fmt(negoRange.end)})`, nego, negoBlock, "prqudoPresentnClosDt"),
      sourceFooter(["bid"], [D2B_NOTE]),
    ]);
  },
};
