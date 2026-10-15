import { z } from "zod";
import { Budget } from "../../common/client.js";
import { parseDateInput, todayYmd, addDays } from "../../common/dates.js";
import { val, won, has, joinLines, sourceFooter, NOT_FOUND } from "../../common/format.js";
import { d2bMonth } from "../services.js";
import { d2bAll, orntMatch, sortByDesc, D2B_NOTE } from "../lib.js";

function monthInput(s, field) {
  if (!s) return undefined;
  const t = String(s).trim();
  const m = t.match(/^(\d{4})[-./]?(\d{1,2})$/);
  if (m) return `${m[1]}${m[2].padStart(2, "0")}01`;
  return parseDateInput(t, field);
}

export function planBlock(it) {
  return joinLines([
    `■ ${val(it.orderPrearngeMt) || "?"} 발주예정 · ${val(it.cntrwkNm)}`,
    `  공사번호 ${val(it.cntrwkNo) || "-"} · 발주기관 ${val(it.ornt) || "-"}${has(it.orntCode) ? ` (${val(it.orntCode)})` : ""}${has(it.cntrwkSe) ? ` · ${val(it.cntrwkSe)}` : ""}`,
    `  예산 ${won(it.budgetAmount) || "-"} · ${[val(it.cntrctMth), val(it.bidMth)].filter(Boolean).join(" · ") || "-"}${has(it.progrsSttus) ? ` · ${val(it.progrsSttus)}` : ""}`,
  ]);
}

export default {
  name: "d2b_plans",
  title: "D2B 시설 조달계획",
  description:
    "D2B 시설 조달계획(발주 예정 사업)을 발주예정월 기준으로 조회한다. 공고 전에 앞으로 나올 공사·용역을 미리 본다. 기본: 이번 달 ~ 6개월 뒤. " +
    "결과의 공사번호·발주기관코드를 d2b_project에 넘기면 계획~계약 연혁과 상세(위치·규모·입찰예정일)를 본다.",
  inputSchema: {
    keyword: z.string().optional().describe("공사명 일부 (예: 설계)"),
    institution: z.string().optional().describe("발주기관명 일부 — 받아온 목록에서 거름"),
    from_month: z.string().optional().describe("시작 발주예정월 YYYY-MM (기본 이번 달)"),
    to_month: z.string().optional().describe("끝 발주예정월 YYYY-MM (기본 6개월 뒤)"),
    limit: z.coerce.number().int().min(1).max(300).optional().describe("표시 최대 건수. 기본 50"),
  },
  async run(a) {
    const from = monthInput(a.from_month, "시작월") || todayYmd();
    const to = monthInput(a.to_month, "끝월") || addDays(from, 183);
    const limit = a.limit || 50;
    const budget = new Budget(20);
    const r = await d2bAll("planList", { cntrwkNm: a.keyword, orderPrearngeMtBegin: d2bMonth(from), orderPrearngeMtEnd: d2bMonth(to) }, { maxRows: 1000, budget });
    const rows = r.items.filter((it) => orntMatch(it, a.institution));
    const shown = sortByDesc(rows, "orderPrearngeMt").reverse().slice(0, limit);
    return joinLines([
      `[D2B 시설 조달계획] 발주예정 ${d2bMonth(from)} ~ ${d2bMonth(to)}${a.keyword ? ` · 공사명 '${a.keyword}'` : ""}${a.institution ? ` · 발주기관 '${a.institution}'` : ""}`,
      `API 집계 ${r.total}건 · 받은 ${r.items.length}건${r.truncated ? "(앞 1000건까지만)" : ""} · 조건 일치 ${rows.length}건 · 표시 ${shown.length}건 (발주예정월 순)`,
      "",
      shown.length ? shown.map(planBlock).join("\n\n") : `${NOT_FOUND} 조건에 맞는 조달계획이 없습니다.`,
      sourceFooter(["plan"], ["※ 조달계획은 예정 정보라 실제 공고 시기·금액과 다를 수 있습니다.", D2B_NOTE]),
    ]);
  },
};
