// 관심 키워드·브리핑 기록 — 이 PC에 저장(G2B·D2B 공통 파일). 기관은 저장하지 않는다(전 기관 대상).
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export const MAX_KEYWORDS = 20;
const SEEN_KEEP_DAYS = 14;

export function watchFile() {
  if (process.env.BR_DATA_DIR) return join(process.env.BR_DATA_DIR, "watch.json"); // 테스트용
  const base = process.env.LOCALAPPDATA || join(homedir(), ".local", "share");
  return join(base, "bid-radar", "watch.json");
}

export async function readWatch() {
  try {
    const d = JSON.parse(await fs.readFile(watchFile(), "utf8"));
    return { keywords: Array.isArray(d.keywords) ? d.keywords : [], lastBrief: d.lastBrief || {}, seen: d.seen || {} };
  } catch {
    return { keywords: [], lastBrief: {}, seen: {} };
  }
}

export async function writeWatch(w) {
  const f = watchFile();
  await fs.mkdir(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(w, null, 2));
  await fs.rename(tmp, f);
}

export function cleanKeyword(k) {
  return String(k ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
}

// 이미 보여준 건(제품별 id → 처음 본 날짜) — 14일 지나면 지움
export function pruneSeen(map = {}, nowMs = Date.now()) {
  const keep = {};
  for (const [id, at] of Object.entries(map)) if (nowMs - Date.parse(at) < SEEN_KEEP_DAYS * 86400_000) keep[id] = at;
  return keep;
}
