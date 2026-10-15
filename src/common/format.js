// 출력 형식 — 원자료를 바꾸지 않고, 계산값은 반드시 (계산)으로 구분한다.

import { serviceLabel } from "./registry.js";
import { stamp, dday } from "./dates.js";

export const NOT_FOUND = "[NOT_FOUND]";

const EMPTY = new Set(["", "N/A", "n/a", "null", "undefined"]);
export function has(v) {
  return v !== undefined && v !== null && !EMPTY.has(String(v).trim());
}
export function val(v) {
  return has(v) ? String(v).trim() : "";
}

// 원 단위 금액: 원값 그대로 + 읽기 쉬운 억/만 환산(환산은 반올림 표기)
export function won(v) {
  if (!has(v)) return "";
  const raw = String(v).replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return String(v).trim();
  const n = Number(raw);
  const base = `${Math.round(n).toLocaleString("ko-KR")}원`;
  if (Math.abs(n) >= 1e8) return `${base} (약 ${(n / 1e8).toFixed(2).replace(/\.?0+$/, "")}억)`;
  if (Math.abs(n) >= 1e4) return `${base} (약 ${Math.round(n / 1e4).toLocaleString("ko-KR")}만)`;
  return base;
}

// 비교 문장용 — 환산 없이 원값만
export function wonPlain(v) {
  const n = num(v);
  return n == null ? val(v) : `${Math.round(n).toLocaleString("ko-KR")}원`;
}

export function pct(v) {
  return has(v) ? `${String(v).trim()}%` : "";
}

export function when(v) {
  if (!has(v)) return "";
  const d = dday(v);
  return d ? `${val(v)} (${d})` : val(v);
}

export function line(label, value) {
  return has(value) ? `  ${label}: ${value}` : null;
}

// null/undefined는 버리고 ""는 빈 줄로 유지. 연속 빈 줄은 하나로.
export function joinLines(arr) {
  return arr
    .filter((x) => x !== null && x !== undefined && x !== false)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

// 공고번호+차수 → 나라장터 공고 상세 링크(명세서에 기재된 bidNtceDtlUrl 형식)
export function g2bLink(no, ord = "000") {
  if (!has(no)) return "";
  return `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${encodeURIComponent(no)}&bidPbancOrd=${encodeURIComponent(ord || "000")}`;
}

// 출처 꼬리 — 어떤 서비스에서 언제 받았는지
export function sourceFooter(services, extra = []) {
  const names = [...new Set(services)].map((s) => serviceLabel(s)).join(" · ");
  return joinLines([
    "",
    `출처: ${names} (공공데이터포털 data.go.kr) · 조회 ${stamp()}`,
    "※ 표시값은 API 원자료입니다. '(계산)' 표시는 이 도구가 원자료로 계산한 값입니다. 입찰 참가 전 원문 공고서로 최종 확인하세요.",
    ...extra,
  ]);
}

// 여러 줄 텍스트에서 통계용 숫자 추출
export function num(v) {
  if (!has(v)) return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// 첨부파일 쌍(파일명N/URLN) 수집 — 빈 칸은 건너뜀
export function filePairs(item, nameKey, urlKey, max = 10) {
  const out = [];
  for (let i = 1; i <= max; i++) {
    const nm = val(item[`${nameKey}${i}`]);
    const url = val(item[`${urlKey}${i}`]).replace(/\s+/g, "");
    if (nm || url) out.push({ name: nm || `(파일명 없음 ${i})`, url });
  }
  return out;
}

// "[a^b^c],[d^e]" 형식 목록 파싱
export function caretList(s) {
  if (!has(s)) return [];
  const blocks = String(s).match(/\[([^\]]*)\]/g);
  if (!blocks) return [String(s).trim()];
  return blocks.map((b) => b.slice(1, -1).split("^").map((x) => x.trim()));
}

export function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 발주기관 담당자 표시 — 나라장터가 비로그인 화면에서 가리는 방식(성만 표시, 연락처 비공개)을 따른다.
export function officer(name) {
  const n = val(name);
  if (!n) return "";
  return `${[...n][0]}** (연락처는 원문에서 로그인 후 확인)`;
}
