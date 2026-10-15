// 참가자격(면허) 대조 공통 — 회사 등록업종(조달청 사용자정보) vs 공고 면허 제한.
// 판정 규칙(나라장터 공고 화면의 "A과 B" · "[ ] 또는 [ ]" 표기, 국방전자조달 공고 안내문 기준): 같은 그룹의 면허는 모두 보유, 그룹이 여러 개면 그중 하나 이상.
import { callAll } from "./client.js";
import { ApiError, describeError } from "./errors.js";
import { val, has } from "./format.js";
import { todayYmd } from "./dates.js";

export const RULE_NOTE = "판정 기준: 같은 그룹의 면허는 모두, 그룹이 여러 개면 그중 하나 이상 보유(나라장터·국방전자조달 공고 화면 표기 기준). 최종 판단은 공고서로 확인하세요.";

/** 회사 등록업종 { ok, codes: Map(code→{name, state, expired}), error } */
export async function companyIndustries(bizno, { budget, service = "user" } = {}) {
  try {
    const r = await callAll(service, "getPrcrmntCorpIndstrytyInfo02", { inqryDiv: 1, bizno }, { maxRows: 500, budget });
    const today = todayYmd();
    const codes = new Map();
    for (const x of r.items) {
      if (has(x.bizno) && val(x.bizno).replace(/\D/g, "") !== bizno) continue;
      const code = val(x.indstrytyCd);
      if (!code) continue;
      const exp = val(x.vldPrdExprtDt).replace(/\D/g, "").slice(0, 8);
      const st = val(x.indstrytyStatsNm);
      const expired = /경과|말소|취소|정지/.test(st) || (exp.length === 8 && exp < today);
      codes.set(code, { name: val(x.indstrytyNm), state: st, expired });
    }
    return { ok: true, codes };
  } catch (e) {
    if (e instanceof ApiError && e.kind === "auth") throw e;
    return { ok: false, codes: new Map(), error: describeError(e) };
  }
}

/** 업종 하나 보유 여부: "✓" 보유 / "⚠" 보유했지만 만료 / "✗" 없음 */
export function holds(codes, code) {
  const c = codes.get(code);
  if (!c) return "✗";
  return c.expired ? "⚠" : "✓";
}

/**
 * 그룹 판정. groups: [{ id, items:[{ code, name, alt:[{code,name}] }] }]  (alt = 허용업종 — 그중 하나 있으면 그 면허 충족으로 봄)
 * 반환 { verdict: "ok"|"no"|"none", lines:[...], okGroups:[id] }
 */
export function judgeGroups(groups, codes) {
  if (!groups.length) return { verdict: "none", lines: ["  면허 제한: 없음(API 기준)"], okGroups: [] };
  const lines = [];
  const okGroups = [];
  for (const g of groups) {
    let all = true;
    const parts = g.items.map((it) => {
      let mark = holds(codes, it.code);
      let via = "";
      if (mark !== "✓") {
        const alt = (it.alt || []).find((x) => holds(codes, x.code) === "✓");
        if (alt) { mark = "✓"; via = ` (허용업종 ${alt.name || alt.code} 보유)`; }
      }
      if (mark !== "✓") all = false;
      return `${mark} ${it.name || "-"}[${it.code || "?"}]${via}${mark === "⚠" ? " — 보유했으나 유효기간·상태 확인 필요" : ""}`;
    });
    if (all) okGroups.push(g.id);
    lines.push(`  그룹 ${g.id}: ${parts.join(" + ")}${all ? "  → 충족" : ""}`);
  }
  return { verdict: okGroups.length ? "ok" : "no", lines, okGroups };
}

export function verdictLine(v, okGroups) {
  if (v === "none") return "판정: 면허 제한 없음(API 기준) — 다른 자격(지역·실적 등)은 공고서 확인";
  if (v === "ok") return `판정: ✓ 면허 조건 충족 (그룹 ${okGroups.join(", ")})`;
  return "판정: ✗ 충족하는 면허 그룹 없음";
}
