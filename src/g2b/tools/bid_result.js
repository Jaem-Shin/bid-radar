import { z } from "zod";
import { Budget, callAll } from "../../common/client.js";
import { KINDS, KIND_NAMES } from "../services.js";
import { parseBidNo, findNotice, execKey } from "../lookup.js";
import { describeError, ApiError } from "../../common/errors.js";
import { val, won, wonPlain, pct, has, num, joinLines, sourceFooter, NOT_FOUND, g2bLink } from "../../common/format.js";
import { KIND_ENUM } from "./search_bids.js";

async function safe(op, params, budget, maxRows = 500) {
  try {
    const r = await callAll("award", op, params, { maxRows, budget });
    return { ok: true, items: r.items, truncated: r.truncated };
  } catch (e) {
    if (e instanceof ApiError && ["auth", "access", "quota"].includes(e.kind)) throw e;
    return { ok: false, items: [], error: `${op}: ${describeError(e)}` };
  }
}

function bizFmt(b) {
  const s = val(b).replace(/\D/g, "");
  return s.length === 10 ? `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5)}` : val(b);
}

async function detectKind(no, budget) {
  try {
    const f = await findNotice(no, { budget });
    if (f.kind) return f.kind;
  } catch (e) {
    if (!(e instanceof ApiError) || e.kind !== "access") throw e; // 입찰공고 미승인이면 낙찰 쪽으로 탐색
  }
  for (const k of KIND_NAMES) {
    const r = await safe(`getOpengResultListInfo${KINDS[k].suffix}`, { inqryDiv: 4, bidNtceNo: no }, budget, 10);
    if (r.items.some((x) => val(x.bidNtceNo) === no)) return k;
  }
  return null;
}

export default {
  name: "g2b_bid_result",
  title: "개찰·낙찰 결과",
  description:
    "입찰공고번호로 개찰결과를 집행(차수·분류·재입찰) 단위로 보여준다: 진행상태(개찰완료/유찰/재입찰), 최종낙찰업체·금액·낙찰률, 예정가격·기초금액, 개찰순위표, 유찰·재입찰 사유. " +
    "협상에 의한 계약은 기술·가격 점수를 함께 보여준다. 낙찰금액과 순위표의 낙찰행 금액이 다르면 '불일치'로 표시한다. 업체 대표자명·연락처는 출력하지 않는다.",
  inputSchema: {
    bid_no: z.string().describe("입찰공고번호 또는 나라장터 공고 링크"),
    kind: KIND_ENUM.exclude(["전체"]).optional().describe("업무구분을 알면 지정(호출 절약)"),
    top: z.coerce.number().int().min(1).max(100).optional().describe("순위표 표시 행 수. 기본 10"),
  },
  async run(a, ctx) {
    const { no, ord } = parseBidNo(a.bid_no);
    const budget = new Budget(40);
    const kind = a.kind || (await detectKind(no, budget));
    if (!kind) {
      return joinLines([`${NOT_FOUND} 입찰공고번호 ${no}의 공고 또는 개찰결과를 찾지 못했습니다.`, sourceFooter(["award"])]);
    }
    const sfx = KINDS[kind].suffix;
    const [A, B, C, D, F, R] = await Promise.all([
      safe(`getScsbidListSttus${sfx}`, { inqryDiv: 4, bidNtceNo: no }, budget),
      safe(`getOpengResultListInfo${sfx}`, { inqryDiv: 4, bidNtceNo: no }, budget),
      safe(`getOpengResultListInfo${sfx}PreparPcDetail`, { inqryDiv: 2, bidNtceNo: no }, budget),
      safe("getOpengResultListInfoOpengCompt", { bidNtceNo: no }, budget, 1000),
      safe("getOpengResultListInfoFailing", { bidNtceNo: no }, budget),
      safe("getOpengResultListInfoRebid", { bidNtceNo: no }, budget),
    ]);
    const mine = (x) => val(x.bidNtceNo) === no && (!ord || (val(x.bidNtceOrd) || "000") === ord);
    const sets = { A: A.items.filter(mine), B: B.items.filter(mine), C: C.items.filter(mine), D: D.items.filter(mine), F: F.items.filter(mine), R: R.items.filter(mine) };
    const errors = [A, B, C, D, F, R].filter((x) => !x.ok).map((x) => x.error);
    const keys = [...new Set(Object.values(sets).flat().map(execKey))].sort();

    if (!keys.length) {
      return joinLines([
        `[개찰·낙찰 결과] ${no} (${kind})`,
        `${NOT_FOUND} 개찰결과가 API에 없습니다. 개찰 전이거나 결과가 아직 등록되지 않았습니다.`,
        errors.length ? `⚠ 조회 실패: ${errors.join(" / ")}` : null,
        `원문: ${g2bLink(no, ord)}`,
        sourceFooter(["award"]),
      ]);
    }

    const top = a.top || 10;
    const myBiz = (ctx.config.myBizno || "").replace(/\D/g, "");
    const blocks = keys.map((key) => {
      const [, o, cls, rb] = key.split("|");
      const pick = (arr) => arr.filter((x) => execKey(x) === key);
      const aw = pick(sets.A)[0], op = pick(sets.B)[0], pp = pick(sets.C), rank = pick(sets.D), fail = pick(sets.F)[0], rebid = pick(sets.R)[0];
      const state = val(op?.progrsDivCdNm) || val(fail?.opengRsltDivNm) || val(rebid?.opengRsltDivNm) || val(rank[0]?.opengRsltDivNm) || (aw ? "낙찰" : "");
      const lines = [`■ 집행 차수 ${o} · 분류 ${cls} · 재입찰 ${rb}${state ? ` — ${state}` : ""}`];
      const name = val(aw?.bidNtceNm) || val(op?.bidNtceNm);
      if (name) lines.push(`  공고명: ${name}`);
      const cnum = val(aw?.prtcptCnum) || val(op?.prtcptCnum);
      if (cnum) lines.push(`  참가업체수: ${cnum}`);
      if (val(aw?.rlOpengDt) || val(op?.opengDt)) lines.push(`  개찰일시: ${val(aw?.rlOpengDt) || val(op?.opengDt)}${val(aw?.rlOpengDt) ? " (실개찰)" : ""}`);

      if (aw && has(aw.bidwinnrNm)) {
        const ours = myBiz && val(aw.bidwinnrBizno).replace(/\D/g, "") === myBiz ? " ★ 우리 회사" : "";
        lines.push(`  최종낙찰: ${val(aw.bidwinnrNm)} (${bizFmt(aw.bidwinnrBizno)})${ours}`);
        lines.push(`  낙찰금액 ${won(aw.sucsfbidAmt) || "-"} · 낙찰률 ${pct(aw.sucsfbidRate) || "-"}${has(aw.fnlSucsfDate) ? ` · 최종낙찰일 ${val(aw.fnlSucsfDate)}` : ""}`);
      } else if (op && has(op.opengCorpInfo)) {
        const p = val(op.opengCorpInfo).split("^");
        lines.push(`  개찰업체정보(1순위): ${p[0] || "-"}${p[1] ? ` (${bizFmt(p[1])})` : ""}${p[3] ? ` · 투찰금액 ${won(p[3])}` : ""}${p[4] ? ` · 투찰률 ${pct(p[4])}` : ""}`);
      }
      if (fail) lines.push(`  유찰 사유: ${val(fail.nobidRsn) || "(API에 사유 없음)"}`);
      if (rebid) lines.push(`  재입찰 사유: ${val(rebid.rbidRsn) || "(API에 사유 없음)"}${has(rebid.opengDt) ? ` · 재입찰 개찰 ${val(rebid.opengDt)}` : ""}`);

      const plnprc = pp.map((x) => num(x.plnprc)).find((x) => x);
      const bssamt = pp.map((x) => num(x.bssamt)).find((x) => x);
      if (plnprc || bssamt) {
        const rate = plnprc && bssamt ? ` · 사정률 ${((plnprc / bssamt) * 100).toFixed(4)}% (계산: 예정가격÷기초금액)` : "";
        lines.push(`  예정가격 ${won(plnprc) || "-"} · 기초금액 ${won(bssamt) || "-"}${rate}`);
        const drawn = pp.filter((x) => val(x.drwtYn) === "Y").map((x) => val(x.compnoRsrvtnPrceSno)).filter(Boolean);
        if (pp.length > 1) lines.push(`  복수예가 ${pp.length}개${drawn.length ? ` · 추첨된 순번 ${drawn.join(", ")}` : ""}`);
      }

      // 교차대조
      // 낙찰행: 최종낙찰업체 사업자번호와 같은 행(비고 '낙찰하한선미달' 같은 문구에 걸리지 않도록 — 실측 오탐 수정)
      const winBiz = val(aw?.bidwinnrBizno).replace(/\D/g, "");
      const winRow = (winBiz && rank.find((r) => val(r.prcbdrBizno).replace(/\D/g, "") === winBiz)) || rank.find((r) => /^(최종)?낙찰$/.test(val(r.rmrk).trim()));
      if (winRow && num(winRow.opengRank) > 1) {
        lines.push(`  ⓘ 최종낙찰업체는 개찰순위 ${num(winRow.opengRank)}위입니다. 앞 순위 업체가 낙찰되지 않은 사유(적격심사 등)는 API에 없으니 원문에서 확인하세요.`);
      }
      if (aw && winRow && num(aw.sucsfbidAmt) != null && num(winRow.bidprcAmt) != null && num(aw.sucsfbidAmt) !== num(winRow.bidprcAmt)) {
        lines.push(`  ⚠ 불일치: 최종낙찰금액(${wonPlain(aw.sucsfbidAmt)})과 순위표 낙찰행 투찰금액(${wonPlain(winRow.bidprcAmt)})이 다릅니다. 협상·재산정 여부를 원문에서 확인하세요.`);
      }
      if (cnum && rank.length && !D.truncated && Number(cnum) !== rank.length) {
        lines.push(`  ⓘ 참가업체수(${cnum})와 순위표 행 수(${rank.length})가 다릅니다(무효·제외 투찰 포함 여부 차이일 수 있음).`);
      }

      if (rank.length) {
        rank.sort((x, y) => (num(x.opengRank) ?? 9e9) - (num(y.opengRank) ?? 9e9));
        const hasScore = rank.some((r) => has(r.totalEvlAmtVal) || has(r.techEvlVal));
        const fmtRow = (r) => {
          const ours = myBiz && val(r.prcbdrBizno).replace(/\D/g, "") === myBiz ? " ★" : "";
          const score = hasScore ? ` · 기술 ${val(r.techEvlVal) || "-"} / 가격 ${val(r.bidPrceEvlVal) || "-"} / 종합 ${val(r.totalEvlAmtVal) || "-"}` : "";
          return `    ${val(r.opengRank) || "-"}위 ${val(r.prcbdrNm) || "-"} (${bizFmt(r.prcbdrBizno)})${ours} · ${won(r.bidprcAmt) || "-"} · ${pct(r.bidprcrt) || "-"}${score}${has(r.rmrk) ? ` · ${val(r.rmrk)}` : ""}`;
        };
        lines.push(`  개찰순위 (${rank.length}개사${D.truncated ? ", 일부" : ""}, 상위 ${Math.min(top, rank.length)}):`);
        lines.push(...rank.slice(0, top).map(fmtRow));
        const ourIdx = myBiz ? rank.findIndex((r) => val(r.prcbdrBizno).replace(/\D/g, "") === myBiz) : -1;
        if (ourIdx >= top) lines.push("    …", fmtRow(rank[ourIdx]));
      }
      return lines.join("\n");
    });

    return joinLines([
      `[개찰·낙찰 결과] ${no} (${kind})`,
      errors.length ? `⚠ 일부 오퍼레이션 조회 실패(해당 정보 빠짐): ${errors.join(" / ")}` : null,
      "",
      blocks.join("\n\n"),
      "",
      `원문: ${g2bLink(no, ord)}`,
      sourceFooter(["award"]),
    ]);
  },
};
