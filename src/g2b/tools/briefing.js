import { z } from "zod";
import { Budget } from "../../common/client.js";
import { KINDS, resolveKinds } from "../services.js";
import { nowKst, ymdhm, fmtYmdhm, isoToKst, windowsBetween, parseDateInput } from "../../common/dates.js";
import { fanSearch } from "../../common/search.js";
import { val, num, won, when, has, joinLines, sourceFooter, NOT_FOUND } from "../../common/format.js";
import { readWatch, writeWatch, cleanKeyword, pruneSeen } from "../../common/watch.js";
import { KIND_ENUM, noticeBlock } from "./search_bids.js";

const MAX_SINCE_DAYS = 7;
// API 반영이 몇 분 늦는 공고를 놓치지 않도록 지난 브리핑 30분 전부터 다시 보고, 이미 보여준 건은 뺀다
const OVERLAP_MS = 30 * 60_000;

function prespecBlock(kind, it) {
  return joinLines([
    `■ [사전규격·${kind}] ${val(it.prdctClsfcNoNm) || val(it.bfSpecRgstNm) || "(사업명 없음)"}`,
    `  사전규격등록번호 ${val(it.bfSpecRgstNo) || "-"} · 기관 ${val(it.orderInsttNm) || val(it.ntceInsttNm) || "-"}`,
    has(it.asignBdgtAmt) ? `  배정예산 ${won(it.asignBdgtAmt)}` : null,
    `  등록 ${val(it.rgstDt) || "-"} · 의견등록 마감 ${when(it.opninRgstClseDt) || "-"}`,
  ]);
}

export default {
  name: "g2b_briefing",
  title: "나라장터 신규 공고 브리핑",
  readOnly: false, // 마지막 브리핑 시각을 저장한다
  description:
    "저장된 관심 키워드(g2b_keywords)로 지난 브리핑 이후 새로 올라온 나라장터 입찰공고와 사전규격을 모아 보여준다(전 기관). " +
    "처음이거나 오래됐으면 최근 1일, 최대 7일. 브리핑한 시각을 기억해 다음에는 그 이후 건만 보여준다. '오늘 새 공고', '브리핑' 요청에 쓴다.",
  inputSchema: {
    keywords: z.array(z.string()).optional().describe("이번만 쓸 키워드(저장된 키워드 대신)"),
    since: z.string().optional().describe("이 날짜부터 다시 보기 YYYY-MM-DD (최대 7일 전)"),
    kind: KIND_ENUM.optional().describe("업무구분. 기본 용역"),
    limit: z.coerce.number().int().min(1).max(100).optional().describe("구역별 표시 최대 건수. 기본 30"),
    min_price: z.coerce.number().optional().describe("추정가격(사전규격은 배정예산) 하한(원)"),
  },
  async run(a) {
    const w = await readWatch();
    const keywords = (a.keywords?.length ? a.keywords : w.keywords).map(cleanKeyword).filter(Boolean);
    if (!keywords.length) {
      return "[NOT_FOUND] 관심 키워드가 없습니다. g2b_keywords로 먼저 추가하세요(예: 설계 / 건설사업관리, 감리).";
    }
    const now = nowKst();
    const end = ymdhm(now);
    const floor = ymdhm(new Date(now.getTime() - MAX_SINCE_DAYS * 86400_000));
    let since;
    let auto = false;
    if (a.since) since = `${parseDateInput(a.since, "since")}0000`;
    else if (w.lastBrief.g2b) { since = ymdhm(new Date(isoToKst(w.lastBrief.g2b).getTime() - OVERLAP_MS)); auto = true; }
    else since = ymdhm(new Date(now.getTime() - 86400_000));
    if (since < floor) since = floor;
    const windows = windowsBetween(since, end);
    const kinds = resolveKinds(a.kind || "용역");
    const limit = a.limit || 30;
    const budget = new Budget(80);

    const explicit = Boolean(a.keywords?.length || a.since);
    const seen = explicit ? {} : pruneSeen(w.seen.g2b);
    const notices = new Map(), specs = new Map();
    const errors = [];
    let cancelled = 0;
    for (const kw of keywords) {
      const [b, p] = await Promise.all([
        fanSearch({ service: "bid", opFor: (k) => `getBidPblancListInfo${KINDS[k].suffix}PPSSrch`, params: { inqryDiv: 1, bidNtceNm: kw }, kinds, windows, limit: 200, budget }),
        fanSearch({ service: "prespec", opFor: (k) => `getPublicPrcureThngInfo${KINDS[k].suffix}PPSSrch`, params: { inqryDiv: 1, prdctClsfcNoNm: kw }, kinds, windows, limit: 200, budget })
          .catch((e) => ({ rows: [], errors: [`사전규격: ${e.message}`] })),
      ]);
      errors.push(...b.errors, ...p.errors);
      for (const { kind, item } of b.rows) {
        const id = `${val(item.bidNtceNo)}-${val(item.bidNtceOrd) || "000"}`;
        if (seen[`b:${id}`]) continue;
        if (/취소/.test(val(item.ntceKindNm))) { if (!notices.has(id)) { cancelled++; notices.set(id, null); } continue; }
        if (a.min_price && !(num(item.presmptPrce) >= a.min_price)) continue;
        const cur = notices.get(id) || { kind, item, kws: [] };
        cur.kws.push(kw);
        notices.set(id, cur);
      }
      for (const { kind, item } of p.rows) {
        const id = val(item.bfSpecRgstNo);
        if (seen[`s:${id}`]) continue;
        if (a.min_price && !(num(item.asignBdgtAmt) >= a.min_price)) continue;
        const cur = specs.get(id) || { kind, item, kws: [] };
        cur.kws.push(kw);
        specs.set(id, cur);
      }
    }
    const nList = [...notices.values()].filter(Boolean).sort((x, y) => val(y.item.bidNtceDt).localeCompare(val(x.item.bidNtceDt)));
    const sList = [...specs.values()].sort((x, y) => val(y.item.rgstDt).localeCompare(val(x.item.rgstDt)));

    // 저장된 키워드로 자동 범위를 쓴 경우에만 '여기까지 봤음'을 기록
    if (!explicit) {
      const nowIso = new Date().toISOString();
      const mark = { ...seen };
      for (const [k, v] of notices) if (v) mark[`b:${k}`] = nowIso;
      for (const k of specs.keys()) mark[`s:${k}`] = nowIso;
      await writeWatch({ ...w, lastBrief: { ...w.lastBrief, g2b: nowIso }, seen: { ...w.seen, g2b: mark } }).catch(() => {});
    }
    const sec = (title, list, fmt) => joinLines([
      `◆ ${title} ${list.length}건${list.length > limit ? ` (최근 ${limit}건 표시)` : ""}`,
      list.length ? list.slice(0, limit).map((x) => `${fmt(x.kind, x.item)}\n  키워드: ${x.kws.join(", ")}`).join("\n\n") : `  ${NOT_FOUND} 새로 올라온 건이 없습니다.`,
      list.length > limit ? `  … 나머지 ${list.length - limit}건은 since(날짜)와 limit을 늘려 다시 보기로 볼 수 있습니다.` : null,
    ]);
    return joinLines([
      `[나라장터 신규 공고 브리핑] ${fmtYmdhm(since)} ~ ${fmtYmdhm(end)}${auto ? " (지난 브리핑 이후, 이미 본 건 제외)" : ""} · 키워드 ${keywords.join(", ")} · ${kinds.join("·")}${a.min_price ? ` · ${won(a.min_price)} 이상` : ""} · 전 기관`,
      errors.length ? `⚠ 일부 조회 실패(결과에서 빠짐): ${errors.join(" / ")}` : null,
      "",
      sec("입찰공고", nList, noticeBlock),
      cancelled ? `  (같은 기간 취소공고 ${cancelled}건은 제외)` : null,
      "",
      sec("사전규격", sList, prespecBlock),
      "",
      !explicit ? "다음 브리핑은 이번에 보여준 건을 빼고, 그 이후 올라온 건부터 보여줍니다." : null,
      sourceFooter(["bid", "prespec"]),
    ]);
  },
};
