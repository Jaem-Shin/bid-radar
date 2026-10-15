import { z } from "zod";
import { Budget } from "../../common/client.js";
import { KINDS, resolveKinds } from "../services.js";
import { resolveRange } from "../../common/dates.js";
import { fanSearch } from "../../common/search.js";
import { val, num, won, joinLines, sourceFooter, NOT_FOUND } from "../../common/format.js";
import { readWatch, cleanKeyword } from "../../common/watch.js";
import { renderDeadlines } from "../../common/deadlines.js";
import { KIND_ENUM } from "./search_bids.js";

// 공고 목록에 들어 있는 일정 필드(실측 필드명)
const EVENTS = [
  ["pqApplDocRcptDt", "PQ 신청마감"],
  ["bidQlfctRgstDt", "참가자격 등록마감"],
  ["cmmnSpldmdAgrmntClseDt", "공동수급협정 마감"],
  ["bidClseDt", "입찰마감"],
  ["opengDt", "개찰", "opening"],
];

export default {
  name: "g2b_deadlines",
  title: "나라장터 마감 일정판",
  description:
    "관심 키워드(g2b_keywords)에 맞는 진행 중 나라장터 공고의 PQ·참가자격 등록·공동수급협정·입찰 마감·개찰 일정을 날짜순(D-day)으로 모아 보여준다. " +
    "기본 앞으로 14일, 최근 60일 안에 공고된 건 대상(전 기관). 개찰은 include_opening일 때만. 키워드가 넓으면 min_price로 좁힌다. D-day는 계산값.",
  inputSchema: {
    keywords: z.array(z.string()).optional().describe("이번만 쓸 키워드(저장된 키워드 대신)"),
    days: z.coerce.number().int().min(1).max(60).optional().describe("앞으로 며칠까지. 기본 14"),
    kind: KIND_ENUM.optional().describe("업무구분. 기본 용역"),
    min_price: z.coerce.number().optional().describe("추정가격 하한(원) — 예: 100000000"),
    include_opening: z.boolean().optional().describe("개찰 일정도 포함(기본 false)"),
  },
  async run(a) {
    const w = await readWatch();
    const keywords = (a.keywords?.length ? a.keywords : w.keywords).map(cleanKeyword).filter(Boolean);
    if (!keywords.length) return "[NOT_FOUND] 관심 키워드가 없습니다. g2b_keywords로 먼저 추가하세요(예: 설계 / 건설사업관리, 감리).";
    const days = a.days || 14;
    const kinds = resolveKinds(a.kind || "용역");
    const { windows } = resolveRange(undefined, undefined, { defaultDays: 60, maxMonths: 3 });
    const budget = new Budget(80);
    const seen = new Map();
    const errors = [];
    for (const kw of keywords) {
      const r = await fanSearch({ service: "bid", opFor: (k) => `getBidPblancListInfo${KINDS[k].suffix}PPSSrch`, params: { inqryDiv: 1, bidNtceNm: kw }, kinds, windows, limit: 300, budget });
      errors.push(...r.errors);
      for (const { item } of r.rows) {
        if (/취소/.test(val(item.ntceKindNm))) continue;
        if (a.min_price && !(num(item.presmptPrce) >= a.min_price)) continue;
        const id = `${val(item.bidNtceNo)}-${val(item.bidNtceOrd) || "000"}`;
        // 같은 공고의 여러 차수는 가장 높은 차수만
        const base = val(item.bidNtceNo);
        const prev = seen.get(base);
        if (!prev || val(item.bidNtceOrd) > val(prev.bidNtceOrd)) seen.set(base, { ...item, _id: id });
      }
    }
    const events = [];
    for (const it of seen.values()) {
      for (const [f, label, opt] of EVENTS) {
        if (opt === "opening" && !a.include_opening) continue;
        if (val(it[f])) events.push({ at: val(it[f]), label, title: val(it.bidNtceNm), ref: `${it._id} · ${val(it.ntceInsttNm) || "-"}` });
      }
    }
    const { count, notices, text, cut } = renderDeadlines(events, days);
    return joinLines([
      `[나라장터 마감 일정판] 앞으로 ${days}일 · 키워드 ${keywords.join(", ")} · ${kinds.join("·")}${a.min_price ? ` · 추정가격 ${won(a.min_price)} 이상` : ""} · 전 기관 (최근 60일 공고 대상)`,
      errors.length ? `⚠ 일부 조회 실패(결과에서 빠짐): ${errors.join(" / ")}` : null,
      `대상 공고 ${seen.size}건 · 일정 ${count}개${a.include_opening ? "" : " (개찰 제외)"} · D-day는 계산값`,
      "",
      count ? text : `${NOT_FOUND} 기간 안의 마감 일정이 없습니다.`,
      cut ? `… 이하 ${cut}줄 생략 — days를 줄이거나 min_price로 좁혀 보세요.` : null,
      "",
      "※ 일정은 공고 목록 기준입니다. 정정공고로 바뀔 수 있으니 g2b_bid_detail·원문으로 확인하세요.",
      sourceFooter(["bid"]),
    ]);
  },
};
