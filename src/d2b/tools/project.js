import { z } from "zod";
import { Budget } from "../../common/client.js";
import { describeError, ApiError } from "../../common/errors.js";
import { val, won, has, joinLines, sourceFooter, NOT_FOUND, officer } from "../../common/format.js";
import { d2b, d2bAll, bidDetailByKeys, d2bResultLink, FATAL, D2B_NOTE } from "../lib.js";
import { bidBlock, negoBlock } from "./search_bids.js";
import { contractBlock } from "./contracts.js";

async function safe(fn) {
  try { return { ok: true, items: (await fn()).items }; }
  catch (e) {
    if (e instanceof ApiError && FATAL.includes(e.kind)) throw e;
    return { ok: false, items: [], error: describeError(e) };
  }
}

export default {
  name: "d2b_project",
  title: "D2B 사업 연혁 (계획→공고→결과→계약)",
  description:
    "공사번호+발주기관코드로 한 사업의 조달계획 상세(위치·규모·예산·입찰예정일) → 입찰공고(경쟁·공개수의) → 입찰결과 → 계약을 이어서 보여준다. " +
    "각 단계는 공사명으로 조회한 뒤 공사번호가 정확히 같은 건만 연결한다(이름이 비슷한 다른 사업은 붙이지 않음).",
  inputSchema: {
    cntrwk_no: z.string().describe("공사번호 (다른 D2B 도구 결과에 표시)"),
    ornt_code: z.string().describe("발주기관코드 (다른 D2B 도구 결과에 표시)"),
    name: z.string().optional().describe("공사명 — 계획이 없는 사업이면 필요"),
  },
  async run(a) {
    const cno = String(a.cntrwk_no).trim();
    const oc = String(a.ornt_code).trim();
    const budget = new Budget(40);
    const plan = await safe(() => d2b("planDetail", { orntCode: oc, cntrwkNo: cno }, { budget }));
    const p = plan.items[0] || null;
    const name = val(p?.cntrwkNm) || a.name;
    if (!name) {
      return joinLines([`${NOT_FOUND} 공사번호 ${cno}(${oc})의 조달계획이 없고 공사명도 없어 다음 단계를 찾을 수 없습니다. name(공사명)을 함께 주세요.`, plan.ok ? null : `조달계획 조회 오류: ${plan.error}`, sourceFooter(["plan"], [D2B_NOTE])]);
    }
    const same = (it) => val(it.cntrwkNo) === cno;
    const [bids, negos, results, contracts] = await Promise.all([
      safe(() => d2bAll("bidList", { cntrwkNm: name, orntCode: oc }, { maxRows: 300, budget })),
      safe(() => d2bAll("negoPlanList", { othbcNtatNm: name, orntCode: oc, pblancNoOrCntrwkNo: cno }, { maxRows: 100, budget })),
      safe(() => d2bAll("resultList", { cntrwkNm: name, orntCode: oc }, { maxRows: 300, budget })),
      safe(() => d2bAll("contractList", { cntrctNm: name, orntCode: oc }, { maxRows: 300, budget })),
    ]);
    // 경쟁입찰 목록에는 진행 중 공고만 있다(실측) → 마감된 공고는 결과의 키로 상세를 직접 조회
    if (bids.ok && !bids.items.some(same) && results.ok) {
      const extra = [];
      for (const r of results.items.filter(same).slice(0, 3)) {
        try {
          const d = await bidDetailByKeys(r, { budget });
          if (d) extra.push({ ...r, ...d, g2bPblancNo: d.g2bPblancNo });
        } catch { /* 결과 단계에 이미 표시됨 */ }
      }
      bids.items.push(...extra);
    }
    const sec = (title, r, fmt) => joinLines([
      `◆ ${title}`,
      r.ok ? (r.items.filter(same).length ? r.items.filter(same).map(fmt).join("\n\n") : `  ${NOT_FOUND} 공사번호 ${cno}와 일치하는 건 없음 (공사명 '${name}'으로 조회)`) : `  ⚠ 조회 실패: ${r.error}`,
    ]);
    const resultFmt = (it) => `■ ${val(it.cntrwkNm)} — ${val(it.bidResult) || "결과 미표기"}\n  공고번호 ${val(it.pblancNo)}-${val(it.pblancOdr)} · 개찰 ${val(it.opengDt) || val(it.opengDate)} → 상세는 d2b_bid_result${d2bResultLink(it) ? `\n  ${d2bResultLink(it)}` : ""}`;
    return joinLines([
      `[D2B 사업 연혁] ${name}`,
      `공사번호 ${cno} · 발주기관코드 ${oc}`,
      "",
      "◆ 1. 조달계획",
      p ? joinLines([
        `  ${val(p.ornt) || "-"} · ${val(p.cntrwkSe) || "-"} · 발주예정 ${val(p.orderPrearngeMt) || "-"} · 입찰예정 ${val(p.bidPrearngeDate) || "-"}`,
        `  총예산 ${won(p.totBudgetAmount) || "-"} · 당해연도 ${won(p.prtintYearBudgetAmount) || "-"} · ${[val(p.cntrctMth), val(p.bidMth), val(p.sucbidrDecsnMth)].filter(Boolean).join(" · ")}`,
        has(p.lc) ? `  위치 ${val(p.lc)}` : null,
        /\d/.test(val(p.scale)) ? `  규모 ${val(p.scale)}` : null, // "/㎡"처럼 단위만 오는 빈 값은 숨김
        has(p.cntrwkPd) ? `  공사기간 ${val(p.cntrwkPd)}` : null,
        has(p.cntrwkSumry) ? `  개요 ${val(p.cntrwkSumry)}` : null,
        has(p.chargerNm) ? `  담당 ${officer(p.chargerNm)}` : null,
      ]) : plan.ok ? `  ${NOT_FOUND} 조달계획 없음` : `  ⚠ 조회 실패: ${plan.error}`,
      "",
      sec("2. 입찰공고(경쟁)", bids, bidBlock),
      "",
      sec("2-1. 공개수의협상계획", negos, negoBlock),
      "",
      sec("3. 입찰결과", results, resultFmt),
      "",
      sec("4. 계약", contracts, contractBlock),
      sourceFooter(["plan", "bid", "result", "contract"], [D2B_NOTE]),
    ]);
  },
};
