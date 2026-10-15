// 날짜 처리 — 전부 한국시간(KST) 기준.

const KST_OFFSET = 9 * 3600_000;

export function nowKst() {
  return new Date(Date.now() + KST_OFFSET); // UTC 필드로 KST 값을 읽는다
}

export function ymd(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function todayYmd() {
  return ymd(nowKst());
}

export function stamp() {
  const d = nowKst();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} KST`;
}

// "2025-07-01", "20250701", "2025.07.01", "2025/7/1" → "20250701"
export function parseDateInput(s, field = "날짜") {
  if (!s) return undefined;
  const m = String(s).trim().match(/^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})$/);
  if (!m) throw new Error(`${field} 형식을 알 수 없습니다: ${s} (예: 2026-10-15)`);
  const [, y, mo, d] = m;
  const out = `${y}${mo.padStart(2, "0")}${d.padStart(2, "0")}`;
  const dt = toUtcDate(out);
  if (ymd(dt) !== out) throw new Error(`${field}가 존재하지 않는 날짜입니다: ${s}`);
  return out;
}

export function toUtcDate(yyyymmdd) {
  return new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)));
}

export function addDays(yyyymmdd, n) {
  const d = toUtcDate(yyyymmdd);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

/**
 * 조회 구간 확정. 기본은 오늘 기준 최근 defaultDays일.
 * maxMonths를 넘는 범위는 거절(호출량 보호).
 */
export function resolveRange(from, to, { defaultDays = 30, maxMonths = 12 } = {}) {
  const end = parseDateInput(to, "종료일") || todayYmd();
  const start = parseDateInput(from, "시작일") || addDays(end, -defaultDays);
  if (start > end) throw new Error(`시작일(${start})이 종료일(${end})보다 늦습니다.`);
  const months = splitMonths(start, end);
  if (months.length > maxMonths) {
    throw new Error(`조회 기간이 ${months.length}개월입니다. 한 번에 최대 ${maxMonths}개월까지 조회합니다.`);
  }
  return { start, end, windows: months };
}

// 캘린더 월 경계로 분할 — data.go.kr 1개월 제한(고정 31일 창은 2월 구간에서 결과코드 07).
export function splitMonths(start, end) {
  const out = [];
  let cur = toUtcDate(start);
  const last = toUtcDate(end);
  while (cur <= last) {
    const monthEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
    const eff = monthEnd > last ? last : monthEnd;
    out.push({ bgn: `${ymd(cur)}0000`, end: `${ymd(eff)}2359` });
    cur = new Date(eff);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// API 일시 문자열("2025-07-15 10:00:00", "2025-07-14 18:00", "20250303 18:00") → Date(KST를 UTC필드로)
export function parseApiDateTime(s) {
  if (!s) return null;
  const t = String(s).trim();
  // "2026-10-15 10:00:00" · "2026-10-15 10:00" · "20261015 18:00" · "202610151000" · "20261015100000" · "2026-10-15"
  const m = t.match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})(?:[ T]?(\d{2}):?(\d{2})(?::?(\d{2}))?)?/);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", se = "0"] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
}

// D-day 표기(계산값). 지난 일정은 "경과".
export function dday(s) {
  const t = parseApiDateTime(s);
  if (!t) return "";
  const now = nowKst();
  const diffMs = t.getTime() - now.getTime();
  const dayDiff = Math.round((toUtcDate(ymd(t)) - toUtcDate(ymd(now))) / 86400_000);
  if (diffMs < 0) return "경과";
  if (dayDiff === 0) return "오늘";
  return `D-${dayDiff}`;
}

// KST 일시(nowKst 형식 Date) → "YYYYMMDDHHmm" (G2B 조회 파라미터)
export function ymdhm(d) {
  return `${ymd(d)}${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
// "YYYYMMDDHHmm" → "YYYY-MM-DD HH:mm"
export function fmtYmdhm(s) {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
}
// ISO(UTC) → KST Date(nowKst 형식)
export function isoToKst(iso) {
  return new Date(Date.parse(iso) + KST_OFFSET);
}
// 시작 "YYYYMMDDHHmm" ~ 끝 "YYYYMMDDHHmm"을 달 경계로 나눈 조회 창(분 단위 유지)
export function windowsBetween(bgn, end) {
  const out = splitMonths(bgn.slice(0, 8), end.slice(0, 8));
  if (!out.length) return out;
  out[0] = { ...out[0], bgn };
  out[out.length - 1] = { ...out[out.length - 1], end };
  return out;
}
