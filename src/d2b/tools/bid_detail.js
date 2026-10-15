import { z } from "zod";
import { Budget } from "../../common/client.js";
import { resolveRange, addDays, todayYmd } from "../../common/dates.js";
import { describeError } from "../../common/errors.js";
import { val, won, pct, when, has, line, joinLines, sourceFooter, NOT_FOUND, num, wonPlain, officer } from "../../common/format.js";
import { d2bDate } from "../services.js";
import { d2b, scanWindows, noticeWarn, splitList, g2bLinkNo, d2bBidLink, d2bNegoLink, wonNZ, registJdgmnText, bidDetailByKeys, NEGO_AHEAD_DAYS, D2B_NOTE } from "../lib.js";

function section(title, rows) {
  const body = joinLines(rows);
  return body ? `\n◆ ${title}\n${body}` : "";
}

// D2B 공고번호 형식은 기관마다 달라 하이픈이 번호 일부일 수 있다 → 차수는 order 인자로만 받는다.
export function parseD2bNo(input) {
  const s = String(input || "").trim();
  if (!s) throw new Error("D2B 공고번호가 비어 있습니다");
  return { no: s, ord: undefined };
}

// 비교는 공백·기호를 뺀 값으로(표기 차이 흡수, 번호 자체는 그대로 표시)
export const sameNo = (a, b) => String(a).replace(/[^0-9A-Za-z가-힣]/g, "").toUpperCase() === String(b).replace(/[^0-9A-Za-z가-힣]/g, "").toUpperCase();

/** 공고 찾기: 경쟁(진행 중) → 공개수의 → 마감된 경쟁(결과 목록의 키로 상세). 반환 { no, ord, kind, it, closed, errors } */
export async function locateD2bNotice(a, budget) {
    const { no, ord: ord0 } = parseD2bNo(a.bid_no);
    const ord = a.order || ord0;
    const { windows } = resolveRange(a.from, undefined, { defaultDays: 120, maxMonths: 13 });
    const match = (it) => sameNo(val(it.pblancNo), no) && (!ord || Number(val(it.pblancOdr)) === Number(ord));

    let kind = "경쟁";
    let found = await scanWindows({
      opKey: "bidList", windows, budget, limit: 50, keep: match, params: { cntrwkNm: a.keyword }, perWindow: 1000,
      dateParams: (w) => ({ anmtDateBegin: d2bDate(w.bgn.slice(0, 8)), anmtDateEnd: d2bDate(w.end.slice(0, 8)) }),
    });
    if (!found.rows.length) {
      kind = "공개수의";
      const ahead = addDays(todayYmd(), NEGO_AHEAD_DAYS);
      found = await scanWindows({
        opKey: "negoPlanList", windows: resolveRange(a.from, ahead, { defaultDays: 150, maxMonths: 14 }).windows, budget, limit: 50, keep: match, params: { othbcNtatNm: a.keyword }, perWindow: 1000,
        dateParams: (w) => ({ prqudoPresentnClosDateBegin: d2bDate(w.bgn.slice(0, 8)), prqudoPresentnClosDateEnd: d2bDate(w.end.slice(0, 8)) }),
      });
    }
    // 마감된 경쟁입찰은 목록에 없다 → 입찰결과 목록에서 키를 찾아 상세를 직접 조회
    let closed = null;
    if (!found.rows.length) {
      const res = await scanWindows({
        opKey: "resultList", windows, budget, limit: 20, keep: match, params: { cntrwkNm: a.keyword }, perWindow: 1000,
        dateParams: (w) => ({ opengDateBegin: d2bDate(w.bgn.slice(0, 8)), opengDateEnd: d2bDate(w.end.slice(0, 8)) }),
      });
      const r0 = res.rows.sort((x, y) => Number(val(y.pblancOdr)) - Number(val(x.pblancOdr)))[0];
      if (r0) {
        try { closed = await bidDetailByKeys(r0, { budget }); } catch { closed = null; }
        if (closed) { kind = "경쟁(마감)"; found = { rows: [{ ...r0, ...closed }], errors: found.errors }; }
      }
    }
    if (!found.rows.length) return { no, ord, kind: null, it: null, closed: null, errors: found.errors };
    const it = found.rows.sort((x, y) => Number(val(y.pblancOdr)) - Number(val(x.pblancOdr)))[0];
    return { no, ord, kind, it, closed, errors: found.errors };
}

export default {
  name: "d2b_bid_detail",
  title: "D2B 시설 입찰공고 종합카드",
  description:
    "D2B 시설 입찰공고 1건의 상세: 공사개요·위치·규모·공사기간, 예산·추정가격·기초금액(토목/건축)·사정률 범위·낙찰하한율, 면허·지역 제한, 공동수급, 일정(참가신청·입찰서 마감·개찰·현장설명회·사전심사), 담당자. " +
    "공고번호로 최근 목록(기본 120일)에서 찾은 뒤 상세를 조회한다. 공개수의협상계획도 찾는다. 참가 가능 여부는 판정하지 않는다.",
  inputSchema: {
    bid_no: z.string().describe("D2B 공고번호"),
    order: z.string().optional().describe("공고차수(모르면 생략 — 가장 높은 차수)"),
    keyword: z.string().optional().describe("공사명 일부 — 주면 목록 검색이 빨라짐"),
    from: z.string().optional().describe("찾을 기간 시작일 YYYY-MM-DD (기본 120일 전)"),
  },
  async run(a) {
    const budget = new Budget(60);
    const { no, ord, kind, it, closed, errors } = await locateD2bNotice(a, budget);
    const found = { errors };
    if (!it) {
      return joinLines([
        `${NOT_FOUND} D2B 공고번호 ${no}${ord ? `-${ord}` : ""}를 최근 목록(시설 경쟁입찰·공개수의)에서 찾지 못했습니다.`,
        found.errors.length ? `조회 오류: ${found.errors.join(" / ")}` : null,
        "공고일이 더 오래됐으면 from을 앞당기고, 공사명 일부(keyword)를 주면 정확해집니다.",
        sourceFooter(["bid"], [D2B_NOTE]),
      ]);
    }

    let d = null, detailErr = null;
    try {
      const r = closed ? { items: [closed] } : kind.startsWith("경쟁")
        ? await d2b("bidDetail", { pblancYear: val(it.pblancYear), pblancSeCode: val(it.pblancSeCode), pblancNo: val(it.pblancNo), pblancOdr: val(it.pblancOdr), cntrwkNo: val(it.cntrwkNo), orntCode: val(it.orntCode) }, { budget })
        : await d2b("negoPlanDetail", { orntCode: val(it.orntCode), cntrwkNo: val(it.cntrwkNo), ntatPlanDate: val(it.ntatPlanDate), pblancNo: val(it.pblancNo), pblancOdr: val(it.pblancOdr) }, { budget });
      d = r.items[0] || null;
    } catch (e) {
      detailErr = describeError(e);
    }
    const x = { ...it, ...(d || {}) };

    const checks = [];
    if (d) {
      if (has(d.cntrwkNm) && val(d.cntrwkNm) !== val(it.cntrwkNm)) checks.push(`⚠ 불일치: 공사명이 목록과 상세에서 다릅니다 (목록 "${val(it.cntrwkNm)}" / 상세 "${val(d.cntrwkNm)}")`);
      const lb = num(it.baseAmnt), db = num(d.bsisPreparPc ?? d.baseAmnt);
      if (lb != null && db != null && lb !== db) checks.push(`⚠ 불일치: 기초예비가격이 목록(${wonPlain(lb)})과 상세(${wonPlain(db)})에서 다릅니다`);
    }

    return joinLines([
      `[D2B 시설 입찰공고] ${val(x.cntrwkNm)}${noticeWarn(x.pblancSe)}`,
      `공고번호 ${no}-${val(x.pblancOdr) || "?"} · ${kind}${has(x.pblancSe) ? ` · ${val(x.pblancSe)}` : ""} · 공사번호 ${val(x.cntrwkNo) || "-"}`,
      detailErr ? `⚠ 상세 조회 실패(목록 정보만 표시): ${detailErr}` : null,
      ...checks,
      section("기본", [
        line("발주기관", `${val(x.ornt) || "-"}${has(x.orntCode) ? ` (${val(x.orntCode)})` : ""}`),
        line("게재기관", val(x.pblictInstt)),
        line("업무구분", val(x.busiDivs)),
        line("공사구분", val(x.cntrwkSe)),
        line("계약방법", val(x.cntrctMth)),
        line("입찰형태", val(x.bidStle) || val(x.ntatStle)),
        line("총액/단가", val(x.bidMth)),
        line("낙찰자결정", val(x.sucbidrDecsnMth)),
        line("공동수급", val(x.copertnOutsrcFlflMthd)),
        line("사전심사", val(x.preaudtTrgetAt)),
        line("등록심사 시점", registJdgmnText(x.registJdgmnPnttm)),
        line("나라장터 연계번호", g2bLinkNo({ ...x, g2bPblancNo: it.g2bPblancNo || x.g2bPblancNo }) ? `${g2bLinkNo({ ...x, g2bPblancNo: it.g2bPblancNo || x.g2bPblancNo })} — D2B 제공값, 나라장터 공고번호 형식 아님` : ""),
        line("담당", officer(x.chargerNm)),
      ]),
      section("사업", [
        line("위치", val(x.lc)),
        line("규모", /\d/.test(val(x.scale)) ? val(x.scale) : ""),
        line("공사기간", val(x.cntrwkPd)),
        line("공사개요", val(x.cntrwkSumry)),
      ]),
      section("금액", [
        line("예산", won(x.budgetAmount)),
        line("추정가격", won(x.estmPrce)),
        line("기초예비가격", won(x.bsisPreparPc ?? x.baseAmnt)),
        line("평가기준금액", wonNZ(x.cobaAmnt)),
        line("기초금액(토목/건축)", wonNZ(x.baseEnam) || wonNZ(x.baseCoam) ? `${wonNZ(x.baseEnam) || "-"} / ${wonNZ(x.baseCoam) || "-"}` : ""),
        line("사정률 범위", has(x.asessRtLwlt) || has(x.asessRtUplmt) ? `${val(x.asessRtLwlt)} ~ ${val(x.asessRtUplmt)}` : ""),
        line("낙찰하한율", pct(x.scsbidLwltRt)),
        line("기초예가 적용", val(x.bsisPrdprcApplcAt)),
      ]),
      section("일정 (D-day는 계산값)", [
        line("공고일", val(x.pblancDate)),
        line("현장설명회", [when(x.sptDcMeetngDt), val(x.sptDcMeetngPlace)].filter(Boolean).join(" · ")),
        line("사전심사 마감", when(x.preaudtClosDt)),
        line("입찰참가 신청·등록 마감", when(x.bidPartcptReqstClosDt) || when(x.bidPartcptRegistClosDt)),
        line("견적서 제출 마감", when(x.prqudoPresentnClosDt)),
        line("입찰서 제출 마감", when(x.biddocPresentnClosDt)),
        line("개찰", [val(x.opengDt), val(x.bidPlace) || val(x.ntatPlace)].filter(Boolean).join(" · ")),
      ]),
      section("참가자격 원자료 (판정 아님 — 공고서로 확인)", [
        splitList(x.lcnsLmttList).length ? `  면허제한:\n${splitList(x.lcnsLmttList).map((s) => `    ${s}`).join("\n")}` : "  면허제한: API 결과 없음",
        splitList(x.areaLmttList).length ? `  지역제한: ${splitList(x.areaLmttList).join(", ")}` : `  지역제한: ${"areaLmttList" in x ? "API 결과 없음" : "API에서 제공하지 않음 — 원문에서 확인"}`,
      ]),
      "",
      (kind.startsWith("경쟁") ? d2bBidLink(x) : d2bNegoLink(x)) ? `D2B 원문: ${kind.startsWith("경쟁") ? d2bBidLink(x) : d2bNegoLink(x)}` : null,
      sourceFooter(["bid"], [D2B_NOTE]),
    ]);
  },
};
