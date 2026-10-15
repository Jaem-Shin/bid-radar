// 마감 일정판 공통 — 날짜별로 묶고, 같은 공고의 같은 날 일정은 한 줄로 합친다(D-day 순)
import { parseApiDateTime, nowKst, dday } from "./dates.js";
import { joinLines } from "./format.js";

const WD = ["일", "월", "화", "수", "목", "금", "토"];
const hm = (d) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

/**
 * events: [{ at: "API 일시 문자열", label, title, ref }] → 앞으로 days일 안의 것만.
 * 반환 { count(일정 수), notices(공고 수), text, cut(생략한 줄 수) }
 */
export function renderDeadlines(events, days, { maxLines = 60 } = {}) {
  const now = nowKst();
  const until = now.getTime() + days * 86400_000;
  const rows = events
    .map((e) => ({ ...e, t: parseApiDateTime(e.at) }))
    .filter((e) => e.t && e.t.getTime() >= now.getTime() && e.t.getTime() <= until)
    .sort((x, y) => x.t - y.t);
  const byDay = new Map();
  for (const e of rows) {
    const key = `${e.t.getUTCMonth() + 1}/${e.t.getUTCDate()}(${WD[e.t.getUTCDay()]}) ${dday(e.at)}`;
    if (!byDay.has(key)) byDay.set(key, new Map());
    const day = byDay.get(key);
    const nk = `${e.title}|${e.ref}`;
    if (!day.has(nk)) day.set(nk, { title: e.title, ref: e.ref, items: [] });
    day.get(nk).items.push(`${hm(e.t)} ${e.label}`);
  }
  const lines = [];
  for (const [day, notices] of byDay) {
    lines.push({ head: true, text: `▶ ${day}` });
    for (const n of notices.values()) lines.push({ text: `  ${n.items.join(" · ")} — ${n.title}${n.ref ? ` · ${n.ref}` : ""}` });
  }
  const bodyCount = lines.filter((l) => !l.head).length;
  let shown = 0, cut = 0;
  const out = [];
  for (const l of lines) {
    if (l.head) { if (shown < maxLines) out.push(out.length ? `\n${l.text}` : l.text); continue; }
    if (shown < maxLines) { out.push(l.text); shown++; } else cut++;
  }
  return { count: rows.length, notices: bodyCount, text: out.join("\n"), cut };
}
