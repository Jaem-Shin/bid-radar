import { z } from "zod";
import { Budget } from "../../common/client.js";
import { resolveRange } from "../../common/dates.js";
import { describeError, ApiError } from "../../common/errors.js";
import { val, won, wonPlain, pct, has, num, joinLines, sourceFooter, NOT_FOUND } from "../../common/format.js";
import { d2bDate } from "../services.js";
import { d2b, d2bAll, scanWindows, bizFmt, bidDetailByKeys, d2bBidLink, d2bResultLink, FATAL, D2B_NOTE } from "../lib.js";
import { parseD2bNo, sameNo } from "./bid_detail.js";

async function safe(fn) {
  try { return { ok: true, items: (await fn()).items }; }
  catch (e) {
    if (e instanceof ApiError && FATAL.includes(e.kind)) throw e;
    return { ok: false, items: [], error: describeError(e) };
  }
}

export default {
  name: "d2b_bid_result",
  title: "D2B 시설 개찰·낙찰 결과",
  description:
    "D2B 시설 경쟁입찰 1건의 결과: 입찰결과, 낙찰업체(사업자번호), 예산·기초예비가격·사정률 범위·낙찰하한율, 참가업체 순위표(투찰금액·낙찰률·적격심사 평점), 복수예비가격과 선택된 순번. " +
    "공고번호로 최근 결과 목록(기본 180일, 개찰일 기준)에서 찾는다. 상세의 낙찰업체와 순위표 1위가 다르면 '불일치'로 표시. 업체 대표자명은 출력하지 않는다.",
  inputSchema: {
    bid_no: z.string().describe("D2B 공고번호"),
    order: z.string().optional().describe("공고차수"),
    keyword: z.string().optional().describe("공사명 일부 — 주면 찾기가 빨라짐"),
    from: z.string().optional().describe("찾을 개찰일 시작 YYYY-MM-DD (기본 180일 전)"),
    top: z.coerce.number().int().min(1).max(100).optional().describe("순위표 표시 행 수. 기본 10"),
  },
  async run(a, ctx) {
    const { no, ord: ord0 } = parseD2bNo(a.bid_no);
    const ord = a.order || ord0;
    const { windows } = resolveRange(a.from, undefined, { defaultDays: 180, maxMonths: 13 });
    const budget = new Budget(60);
    const found = await scanWindows({
      opKey: "resultList", windows, budget, limit: 20, perWindow: 1000,
      keep: (it) => sameNo(val(it.pblancNo), no) && (!ord || Number(val(it.pblancOdr)) === Number(ord)),
      params: { cntrwkNm: a.keyword },
      dateParams: (w) => ({ opengDateBegin: d2bDate(w.bgn.slice(0, 8)), opengDateEnd: d2bDate(w.end.slice(0, 8)) }),
    });
    if (!found.rows.length) {
      return joinLines([
        `${NOT_FOUND} D2B 공고번호 ${no}${ord ? `-${ord}` : ""}의 시설 경쟁입찰결과를 찾지 못했습니다(개찰 전이거나 공개수의 건일 수 있음).`,
        found.errors.length ? `조회 오류: ${found.errors.join(" / ")}` : null,
        sourceFooter(["result"], [D2B_NOTE]),
      ]);
    }
    const top = a.top || 10;
    const myBiz = (ctx.config.myBizno || "").replace(/\D/g, "");
    const blocks = [];
    for (const it of found.rows.sort((x, y) => val(y.opengDate).localeCompare(val(x.opengDate)))) {
      const key = { orntCode: val(it.orntCode), cntrwkNo: val(it.cntrwkNo) };
      const opengDate = val(it.opengDate) || val(it.opengDt).slice(0, 10).replace(/\D/g, "");
      const [det, bidders, prices] = await Promise.all([
        safe(() => d2b("resultDetail", { ...key, opengDate, pblancNo: val(it.pblancNo), pblancOdr: val(it.pblancOdr) }, { budget })),
        safe(() => d2bAll("resultBidders", { ...key, ntatPlanDate: opengDate }, { maxRows: 1000, budget })),
        safe(() => d2bAll("resultPrices", { ...key, ntatPlanDate: opengDate }, { maxRows: 100, budget })),
      ]);
      const d = det.items[0] || {};
      const x = { ...it, ...d };
      // 결과 상세에 낙찰하한율·예산이 0/빈값으로 오는 건이 있다(실측) → 공고 상세에서 보충(출처 표시)
      let notice = null;
      try { notice = await bidDetailByKeys(it, { budget }); } catch { notice = null; }
      const fromNotice = [];
      for (const f of ["scsbidLwltRt", "budgetAmount", "asessRtLwlt", "asessRtUplmt"]) {
        if (!num(x[f]) && notice && num(notice[f])) { x[f] = notice[f]; fromNotice.push(f); }
      }
      const lines = [
        `■ ${val(x.cntrwkNm)} — ${val(x.bidResult) || "결과 미표기"}`,
        `  공고번호 ${no}-${val(x.pblancOdr) || "?"} · 공사번호 ${val(x.cntrwkNo)} · 발주기관 ${val(x.ornt) || "-"} (${val(x.orntCode)}) · 개찰 ${val(x.opengDt) || opengDate}`,
        `  ${[val(x.cntrctMth), val(x.bidMth), val(x.sucbidrDecsnMth)].filter(Boolean).join(" · ")}`,
      ];
      if (!det.ok) lines.push(`  ⚠ 상세 조회 실패: ${det.error}`);
      if (has(x.scsbidEntrpsNm)) {
        const ours = myBiz && val(x.scsbidEntrpsBsnmRegistNo).replace(/\D/g, "") === myBiz ? " ★ 우리 회사" : "";
        lines.push(`  낙찰업체: ${val(x.scsbidEntrpsNm)} (${bizFmt(x.scsbidEntrpsBsnmRegistNo)})${ours}`);
      }
      lines.push(`  예산 ${num(x.budgetAmount) ? won(x.budgetAmount) : "-"} · 기초예비가격 ${num(x.bsisPreparPc) ? won(x.bsisPreparPc) : "-"} · 사정률 ${has(x.asessRtLwlt) ? `${val(x.asessRtLwlt)} ~ ${val(x.asessRtUplmt)}` : "-"} · 낙찰하한율 ${num(x.scsbidLwltRt) ? pct(x.scsbidLwltRt) : "-"}${fromNotice.length ? " (일부 값은 입찰공고 상세 기준)" : ""}`);

      if (prices.ok && prices.items.length) {
        const chosen = prices.items.filter((p) => /^Y/i.test(val(p.choiYsno))).map((p) => val(p.epprRank));
        lines.push(`  복수예비가격 ${prices.items.length}개${chosen.length ? ` · 선택된 순번 ${chosen.join(", ")}` : ""}`);
      } else if (!prices.ok) lines.push(`  ⚠ 복수예비가격 조회 실패: ${prices.error}`);

      if (bidders.ok && bidders.items.length) {
        // 순위 '0000'은 순위 외(낙찰하한가 미만 등) → 순위 있는 업체 뒤로(실측)
        const rk = (p) => { const n = num(p.bidnRank); return n && n > 0 ? n : 9e9; };
        const rank = [...bidders.items].sort((p, q) => rk(p) - rk(q) || (num(p.tbidAmnt) ?? 0) - (num(q.tbidAmnt) ?? 0));
        const ranked = rank.filter((p) => rk(p) < 9e9).length;
        const first = rank.find((p) => rk(p) < 9e9);
        if (has(x.scsbidEntrpsBsnmRegistNo) && first && has(first.bznsRgnb) && val(first.bznsRgnb).replace(/\D/g, "") !== val(x.scsbidEntrpsBsnmRegistNo).replace(/\D/g, "")) {
          lines.push(`  ⚠ 불일치: 상세의 낙찰업체(${val(x.scsbidEntrpsNm)})와 순위표 1위(${val(first.mfkrName)})가 다릅니다. 적격심사 탈락·차순위 낙찰 여부를 원문에서 확인하세요.`);
        }
        const fmt = (p) => {
          const ours = myBiz && val(p.bznsRgnb).replace(/\D/g, "") === myBiz ? " ★" : "";
          const r = rk(p) < 9e9 ? `${num(p.bidnRank)}위` : "순위외";
          const note = val(p.bidxNote) && !/^\d+순위$/.test(val(p.bidxNote)) ? val(p.bidxNote) : "";
          return `    ${r} ${val(p.mfkrName) || "-"} (${bizFmt(p.bznsRgnb)})${ours} · ${won(p.tbidAmnt) || "-"} · 투찰률 ${pct(p.bidnRate) || "-"}${num(p.propExgd) ? ` · 적격심사 ${val(p.propExgd)}` : ""}${has(p.bidxRslt) && val(p.bidxRslt) !== "0" ? ` · ${val(p.bidxRslt)}` : ""}${has(p.ubidCaus) ? ` · 유찰사유 ${val(p.ubidCaus)}` : ""}${note ? ` · ${note}` : ""}`;
        };
        lines.push(`  참가업체 ${rank.length}개사 (순위 ${ranked} · 순위외 ${rank.length - ranked}) — 상위 ${Math.min(top, rank.length)}:`, ...rank.slice(0, top).map(fmt));
        const oi = myBiz ? rank.findIndex((p) => val(p.bznsRgnb).replace(/\D/g, "") === myBiz) : -1;
        if (oi >= top) lines.push("    …", fmt(rank[oi]));
      } else if (!bidders.ok) lines.push(`  ⚠ 참가업체 조회 실패: ${bidders.error}`);
      if (d2bResultLink(it)) lines.push(`  결과 원문: ${d2bResultLink(it)}`);
      const link = notice ? d2bBidLink(notice) : "";
      if (link) lines.push(`  공고 원문: ${link}`);
      blocks.push(lines.join("\n"));
    }
    return joinLines([`[D2B 시설 개찰·낙찰 결과] ${no}`, "", blocks.join("\n\n"), "", sourceFooter(["result"], [D2B_NOTE])]);
  },
};
