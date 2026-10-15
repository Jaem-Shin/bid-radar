// 기간(월 단위 창) × 업무구분 팬아웃 검색 — 최근 창·최신 건부터. 부분 실패는 숨기지 않고 errors로 올린다.

import { callLatest } from "./client.js";
import { describeError, ApiError } from "./errors.js";

/**
 * @param opFor (kindName) => operation
 * @param params 기간 외 공통 파라미터
 * @param windows [{bgn,end}] — 최근 창부터 조회
 * @param limit 모을 최대 건수(전체)
 * 반환 { rows:[{kind,item}], total, perKind:{kind:{total,fetched}}, errors:[], truncated }
 */
export async function fanSearch({ service, opFor, params, kinds, windows, limit, budget, perWindowMax = 200 }) {
  const rows = [];
  const perKind = Object.fromEntries(kinds.map((k) => [k, { total: 0, fetched: 0 }]));
  const errors = [];
  const ordered = [...windows].reverse();
  for (const w of ordered) {
    for (const k of kinds) {
      const remaining = limit - rows.length;
      try {
        const r = await callLatest(service, opFor(k), { ...params, inqryBgnDt: w.bgn, inqryEndDt: w.end }, {
          maxRows: remaining > 0 ? Math.min(perWindowMax, remaining) : 0, // 0이면 총건수만
          budget,
        });
        perKind[k].total += r.total;
        const take = remaining > 0 ? r.items.slice(0, remaining) : [];
        perKind[k].fetched += take.length;
        for (const item of take) rows.push({ kind: k, item });
      } catch (e) {
        // 인증·승인·한도 문제는 전 구간 공통이므로 즉시 중단
        if (e instanceof ApiError && ["auth", "access", "quota"].includes(e.kind)) throw e;
        errors.push(`${k} ${w.bgn.slice(0, 8)}~${w.end.slice(0, 8)}: ${describeError(e)}`);
      }
    }
  }
  const total = Object.values(perKind).reduce((a, b) => a + b.total, 0);
  return { rows, total, perKind, errors, truncated: rows.length < total };
}

export function summaryHeader({ title, start, end, basis, total, shown, perKind, errors }) {
  const kindPart = Object.entries(perKind)
    .filter(([, v]) => v.total > 0 || Object.keys(perKind).length === 1)
    .map(([k, v]) => `${k} ${v.total}건`)
    .join(" · ");
  const lines = [
    `[${title}] ${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6)} ~ ${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6)} (${basis} 기준)`,
    `API 집계 ${total}건${kindPart ? ` (${kindPart})` : ""} · 아래 표시 ${shown}건${shown < total ? " — 일부만 표시. 조건을 좁히면 전부 볼 수 있습니다" : ""}`,
  ];
  if (errors.length) lines.push(`⚠ 일부 구간 조회 실패(결과에서 빠짐): ${errors.join(" / ")}`);
  return lines.join("\n");
}
