import { z } from "zod";
import { Budget } from "../../common/client.js";
import { resolveRange, addDays, todayYmd, nowKst, isoToKst, ymd, parseDateInput } from "../../common/dates.js";
import { val, num, won, joinLines, sourceFooter, NOT_FOUND } from "../../common/format.js";
import { readWatch, writeWatch, cleanKeyword, pruneSeen } from "../../common/watch.js";
import { d2bDate } from "../services.js";
import { scanWindows, BUSI_ENUM, busiMatch, isCancelled, NEGO_AHEAD_DAYS, D2B_NOTE } from "../lib.js";
import { bidBlock, negoBlock } from "./search_bids.js";

const MAX_SINCE_DAYS = 7;
const idOf = (it) => `${val(it.pblancNo)}-${val(it.pblancOdr)}`;

export default {
  name: "d2b_briefing",
  title: "D2B 신규 공고 브리핑",
  readOnly: false, // 이미 보여준 공고를 기억한다
  description:
    "저장된 관심 키워드(d2b_keywords)로 국방전자조달(시설) 새 공고를 모아 보여준다(전 기관): 지난 브리핑 이후 공고된 경쟁입찰 + 처음 보는 마감 전 공개수의협상. " +
    "D2B는 공고일만 있어(시각 없음) 이미 보여준 건을 기억해 빼고 보여준다. 처음이면 최근 1일, 최대 7일. 기본 용역.",
  inputSchema: {
    keywords: z.array(z.string()).optional().describe("이번만 쓸 키워드(저장된 키워드 대신)"),
    since: z.string().optional().describe("이 날짜부터 다시 보기 YYYY-MM-DD (최대 7일 전, 본 건도 다시 표시)"),
    busi: BUSI_ENUM.optional().describe("업무구분. 기본 용역"),
    min_price: z.coerce.number().optional().describe("기초예비가격(없으면 예산) 하한(원)"),
  },
  async run(a) {
    const w = await readWatch();
    const keywords = (a.keywords?.length ? a.keywords : w.keywords).map(cleanKeyword).filter(Boolean);
    if (!keywords.length) return "[NOT_FOUND] 관심 키워드가 없습니다. d2b_keywords로 먼저 추가하세요(예: 설계 / 건설사업관리, 감리).";
    const busi = a.busi || "용역";
    const today = todayYmd();
    const floor = addDays(today, -MAX_SINCE_DAYS);
    const explicit = Boolean(a.since || a.keywords?.length);
    let since = a.since ? parseDateInput(a.since, "since") : w.lastBrief.d2b ? ymd(isoToKst(w.lastBrief.d2b)) : addDays(today, -1);
    if (since < floor) since = floor;
    const seen = explicit ? {} : pruneSeen(w.seen.d2b);
    const budget = new Budget(80);
    const { windows } = resolveRange(since, today, { maxMonths: 2 });
    const negoWindows = resolveRange(today, addDays(today, NEGO_AHEAD_DAYS), { maxMonths: 3 }).windows;

    const bids = new Map(), negos = new Map();
    const errors = [];
    for (const kw of keywords) {
      const [b, n] = await Promise.all([
        scanWindows({ opKey: "bidList", windows, budget, limit: 300, perWindow: 300, params: { cntrwkNm: kw }, keep: (it) => busiMatch(it, busi) && !isCancelled(it),
          dateParams: (x) => ({ anmtDateBegin: d2bDate(x.bgn.slice(0, 8)), anmtDateEnd: d2bDate(x.end.slice(0, 8)) }) }),
        scanWindows({ opKey: "negoPlanList", windows: negoWindows, budget, limit: 300, perWindow: 300, params: { othbcNtatNm: kw }, keep: (it) => busiMatch(it, busi) && !isCancelled(it),
          dateParams: (x) => ({ prqudoPresentnClosDateBegin: d2bDate(x.bgn.slice(0, 8)), prqudoPresentnClosDateEnd: d2bDate(x.end.slice(0, 8)) }) }),
      ]);
      errors.push(...b.errors, ...n.errors);
      const priceOk = (it) => !a.min_price || (num(it.baseAmnt) ?? num(it.budgetAmount) ?? 0) >= a.min_price;
      b.rows = b.rows.filter(priceOk); n.rows = n.rows.filter(priceOk);
      for (const it of b.rows) if (!seen[`b:${idOf(it)}`]) { const c = bids.get(idOf(it)) || { it, kws: [] }; c.kws.push(kw); bids.set(idOf(it), c); }
      for (const it of n.rows) if (!seen[`n:${idOf(it)}`]) { const c = negos.get(idOf(it)) || { it, kws: [] }; c.kws.push(kw); negos.set(idOf(it), c); }
    }
    const bList = [...bids.values()].sort((x, y) => val(y.it.pblancDate).localeCompare(val(x.it.pblancDate)));
    const nList = [...negos.values()].sort((x, y) => val(x.it.prqudoPresentnClosDt).localeCompare(val(y.it.prqudoPresentnClosDt)));

    if (!explicit) {
      const now = new Date().toISOString();
      const mark = { ...seen };
      for (const k of bids.keys()) mark[`b:${k}`] = now;
      for (const k of negos.keys()) mark[`n:${k}`] = now;
      await writeWatch({ ...w, lastBrief: { ...w.lastBrief, d2b: now }, seen: { ...w.seen, d2b: mark } }).catch(() => {});
    }
    const sec = (title, list, fmt) => joinLines([
      `◆ ${title} ${list.length}건`,
      list.length ? list.slice(0, 30).map((x) => `${fmt(x.it)}\n  키워드: ${x.kws.join(", ")}`).join("\n\n") : `  ${NOT_FOUND} 새 건이 없습니다.`,
    ]);
    const fmt = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
    return joinLines([
      `[D2B 신규 공고 브리핑] 공고일 ${fmt(since)} ~ ${fmt(today)}${explicit ? "" : " · 이미 보여준 건 제외"} · 키워드 ${keywords.join(", ")} · ${busi}${a.min_price ? ` · ${won(a.min_price)} 이상` : ""} · 전 기관`,
      errors.length ? `⚠ 일부 조회 실패(결과에서 빠짐): ${errors.join(" / ")}` : null,
      "",
      sec("경쟁입찰공고 (새로 공고됨)", bList, bidBlock),
      "",
      sec(explicit ? "공개수의협상 (마감 전)" : "공개수의협상 (마감 전, 처음 보는 건)", nList, negoBlock),
      "",
      explicit ? null : "다음 브리핑은 이번에 보여준 건을 빼고 보여줍니다.",
      sourceFooter(["bid"], [D2B_NOTE]),
    ]);
  },
};
