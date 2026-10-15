import { z } from "zod";
import { Budget } from "../../common/client.js";
import { resolveRange, addDays, todayYmd } from "../../common/dates.js";
import { val, num, won, joinLines, sourceFooter, NOT_FOUND } from "../../common/format.js";
import { readWatch, cleanKeyword } from "../../common/watch.js";
import { renderDeadlines } from "../../common/deadlines.js";
import { d2bDate } from "../services.js";
import { scanWindows, BUSI_ENUM, busiMatch, isCancelled, D2B_NOTE } from "../lib.js";

export default {
  name: "d2b_deadlines",
  title: "D2B 마감 일정판",
  description:
    "관심 키워드(d2b_keywords)에 맞는 진행 중 국방전자조달(시설) 공고의 참가등록 마감·입찰서 마감·개찰과 공개수의 견적서 마감을 날짜순(D-day)으로 보여준다(전 기관). " +
    "기본 앞으로 14일, 용역. 개찰은 include_opening일 때만. D-day는 계산값.",
  inputSchema: {
    keywords: z.array(z.string()).optional().describe("이번만 쓸 키워드(저장된 키워드 대신)"),
    days: z.coerce.number().int().min(1).max(60).optional().describe("앞으로 며칠까지. 기본 14"),
    busi: BUSI_ENUM.optional().describe("업무구분. 기본 용역"),
    min_price: z.coerce.number().optional().describe("기초예비가격(없으면 예산) 하한(원)"),
    include_opening: z.boolean().optional().describe("개찰 일정도 포함(기본 false)"),
  },
  async run(a) {
    const w = await readWatch();
    const keywords = (a.keywords?.length ? a.keywords : w.keywords).map(cleanKeyword).filter(Boolean);
    if (!keywords.length) return "[NOT_FOUND] 관심 키워드가 없습니다. d2b_keywords로 먼저 추가하세요(예: 설계 / 건설사업관리, 감리).";
    const days = a.days || 14;
    const busi = a.busi || "용역";
    const today = todayYmd();
    const budget = new Budget(80);
    // 경쟁입찰 목록은 진행 중 공고만 준다(실측) → 최근 60일 공고일로 조회
    const bidWin = resolveRange(addDays(today, -60), today, { maxMonths: 3 }).windows;
    const negoWin = resolveRange(today, addDays(today, days), { maxMonths: 3 }).windows;
    const bids = new Map(), negos = new Map();
    const errors = [];
    const priceOk = (it) => !a.min_price || (num(it.baseAmnt) ?? num(it.budgetAmount) ?? 0) >= a.min_price;
    for (const kw of keywords) {
      const [b, n] = await Promise.all([
        scanWindows({ opKey: "bidList", windows: bidWin, budget, limit: 300, perWindow: 300, params: { cntrwkNm: kw }, keep: (it) => busiMatch(it, busi) && !isCancelled(it),
          dateParams: (x) => ({ anmtDateBegin: d2bDate(x.bgn.slice(0, 8)), anmtDateEnd: d2bDate(x.end.slice(0, 8)) }) }),
        scanWindows({ opKey: "negoPlanList", windows: negoWin, budget, limit: 300, perWindow: 300, params: { othbcNtatNm: kw }, keep: (it) => busiMatch(it, busi) && !isCancelled(it),
          dateParams: (x) => ({ prqudoPresentnClosDateBegin: d2bDate(x.bgn.slice(0, 8)), prqudoPresentnClosDateEnd: d2bDate(x.end.slice(0, 8)) }) }),
      ]);
      errors.push(...b.errors, ...n.errors);
      for (const it of b.rows) if (priceOk(it)) bids.set(`${val(it.pblancNo)}-${val(it.pblancOdr)}`, it);
      for (const it of n.rows) if (priceOk(it)) negos.set(`${val(it.pblancNo)}-${val(it.pblancOdr)}`, it);
    }
    const events = [];
    for (const [id, it] of bids) {
      const ref = `${id} · ${val(it.ornt) || "-"}`;
      if (val(it.bidPartcptRegistClosDt)) events.push({ at: val(it.bidPartcptRegistClosDt), label: "참가등록 마감", title: val(it.cntrwkNm), ref });
      if (val(it.biddocPresentnClosDt)) events.push({ at: val(it.biddocPresentnClosDt), label: "입찰서 마감", title: val(it.cntrwkNm), ref });
      if (a.include_opening && val(it.opengDt)) events.push({ at: val(it.opengDt), label: "개찰", title: val(it.cntrwkNm), ref });
    }
    for (const [id, it] of negos) {
      if (val(it.prqudoPresentnClosDt)) events.push({ at: val(it.prqudoPresentnClosDt), label: "견적서 마감(공개수의)", title: val(it.cntrwkNm), ref: `${id} · ${val(it.ornt) || "-"}` });
    }
    const { count, text, cut } = renderDeadlines(events, days);
    return joinLines([
      `[D2B 마감 일정판] 앞으로 ${days}일 · 키워드 ${keywords.join(", ")} · ${busi}${a.min_price ? ` · ${won(a.min_price)} 이상` : ""} · 전 기관`,
      errors.length ? `⚠ 일부 조회 실패(결과에서 빠짐): ${errors.join(" / ")}` : null,
      `대상 경쟁입찰 ${bids.size}건 · 공개수의 ${negos.size}건 · 일정 ${count}개${a.include_opening ? "" : " (개찰 제외)"} · D-day는 계산값`,
      "",
      count ? text : `${NOT_FOUND} 기간 안의 마감 일정이 없습니다.`,
      cut ? `… 이하 ${cut}줄 생략 — days를 줄이거나 min_price로 좁혀 보세요.` : null,
      "",
      "※ 정정공고로 일정이 바뀔 수 있으니 d2b_bid_detail·원문으로 확인하세요.",
      sourceFooter(["bid"], [D2B_NOTE]),
    ]);
  },
};
