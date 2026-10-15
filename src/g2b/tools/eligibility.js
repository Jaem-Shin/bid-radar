import { z } from "zod";
import { Budget, callAll } from "../../common/client.js";
import { describeError } from "../../common/errors.js";
import { val, has, joinLines, sourceFooter, g2bLink, caretList, NOT_FOUND } from "../../common/format.js";
import { parseBidNo, findNotice, pickOrder } from "../lookup.js";
import { companyIndustries, judgeGroups, verdictLine, RULE_NOTE } from "../../common/eligibility.js";

async function side(op, params, budget) {
  try { return { ok: true, items: (await callAll("bid", op, params, { maxRows: 100, budget })).items }; }
  catch (e) { return { ok: false, items: [], error: describeError(e) }; }
}

// "건축사사무소/4817" → { name, code }
export function parseLicense(s) {
  const t = val(s);
  const m = t.match(/^(.*?)[/\s]*\[?(\d{4})\]?$/);
  return m ? { name: m[1].replace(/\/$/, "").trim(), code: m[2] } : { name: t, code: "" };
}

export default {
  name: "g2b_eligibility",
  title: "나라장터 참가자격(면허) 점검",
  description:
    "나라장터 공고 1건의 면허(업종) 제한을 회사 등록업종(조달청 사용자정보)과 대조해 그룹별 보유 여부와 판정(충족/미충족)을 근거와 함께 보여준다. " +
    "참가가능지역은 회사 소재지와 나란히 보여준다. 사업자번호를 생략하면 설정된 회사 번호. 판정 규칙과 '공고서 확인' 안내를 함께 낸다.",
  inputSchema: {
    bid_no: z.string().describe("입찰공고번호 또는 나라장터 공고 링크"),
    bizno: z.string().optional().describe("사업자번호 10자리(생략 시 설정된 회사)"),
    kind: z.enum(["용역", "공사", "물품", "외자"]).optional().describe("업무구분을 알면 지정"),
  },
  async run(a, { config }) {
    const bizno = String(a.bizno || config.myBizno || "").replace(/\D/g, "");
    if (bizno.length !== 10) return "[ERROR] 사업자번호 10자리가 필요합니다. 인자로 주거나 확장 설정(또는 환경변수 MY_BIZNO)에 회사 사업자번호를 넣으세요.";
    const { no, ord } = parseBidNo(a.bid_no);
    const budget = new Budget(20);
    const found = await findNotice(no, { kind: a.kind, budget });
    if (!found.kind) return joinLines([`${NOT_FOUND} 입찰공고번호 ${no}를 찾지 못했습니다.`, sourceFooter(["bid"])]);
    const { chosen: it } = pickOrder(found.items, ord);
    if (!it) return `${NOT_FOUND} ${no}의 차수 ${ord}가 없습니다.`;
    const o = val(it.bidNtceOrd) || "000";
    const byNoOrd = { inqryDiv: 2, bidNtceNo: no, bidNtceOrd: o };
    const [lic, rgn, ind, basic] = await Promise.all([
      side("getBidPblancListInfoLicenseLimit", byNoOrd, budget),
      side("getBidPblancListInfoPrtcptPsblRgn", byNoOrd, budget),
      companyIndustries(bizno, { budget }),
      callAll("user", "getPrcrmntCorpBasicInfo02", { inqryDiv: 3, bizno }, { maxRows: 5, budget }).then((r) => r.items.find((x) => val(x.bizno).replace(/\D/g, "") === bizno) || null).catch(() => null),
    ]);
    const disp = `${bizno.slice(0, 3)}-${bizno.slice(3, 5)}-${bizno.slice(5)}`;
    const head = [
      `[참가자격 점검] ${val(it.bidNtceNm)}`,
      `공고번호 ${no}-${o} · ${found.kind} · ${val(it.ntceInsttNm) || "-"}`,
      `업체 ${val(basic?.corpNm) || disp} (${disp})${config.myBizno === bizno ? " — 설정된 우리 회사" : ""}`,
      "",
    ];
    if (!lic.ok) return joinLines([...head, `⚠ 면허제한 조회 실패: ${lic.error}`, sourceFooter(["bid"])]);
    if (!ind.ok) return joinLines([...head, `⚠ 회사 등록업종 조회 실패: ${ind.error} — 조달청 사용자정보서비스 활용승인이 필요합니다.`, sourceFooter(["bid", "user"])]);
    if (!ind.codes.size) return joinLines([...head, `${NOT_FOUND} 사업자번호 ${disp}의 나라장터 등록업종이 없습니다.`, sourceFooter(["bid", "user"])]);

    const rows = lic.items.filter((x) => (val(x.bidNtceOrd) || "000") === o || !has(x.bidNtceOrd));
    const byGroup = new Map();
    for (const r of rows) {
      const g = val(r.lmtGrpNo) || "1";
      const l = parseLicense(r.lcnsLmtNm);
      const alt = caretList(r.permsnIndstrytyList).map((b) => {
        const parts = Array.isArray(b) ? b : [b];
        return { code: parts.find((t) => /^\d{4}$/.test(t)) || "", name: parts.find((t) => !/^\d+$/.test(t)) || "" };
      }).filter((x) => x.code);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push({ ...l, alt });
    }
    const groups = [...byGroup.entries()].sort((x, y) => Number(x[0]) - Number(y[0])).map(([id, items]) => ({ id, items }));
    const j = judgeGroups(groups, ind.codes);
    const regions = rgn.ok ? rgn.items.map((r) => val(r.prtcptPsblRgnNm)).filter(Boolean) : null;
    const addr = val(basic?.adrs).startsWith(val(basic?.rgnNm)) ? val(basic?.adrs) : [val(basic?.rgnNm), val(basic?.adrs)].filter(Boolean).join(" ");
    return joinLines([
      ...head,
      verdictLine(j.verdict, j.okGroups),
      "",
      "◆ 면허(업종) 대조 — ✓ 보유 · ✗ 미보유 · ⚠ 보유했지만 만료·상태 확인",
      ...j.lines,
      "",
      "◆ 참가가능지역 (판정 안 함 — 나란히 표시)",
      `  공고: ${regions === null ? `조회 실패 — ${rgn.error}` : regions.length ? regions.join(", ") : "제한 없음(API 기준)"}`,
      `  회사 소재지: ${addr || "-"}`,
      "",
      `※ ${RULE_NOTE}`,
      "※ 실적·기술인력·공동수급 등 다른 자격은 이 점검에 들어 있지 않습니다.",
      `원문: ${g2bLink(no, o)}`,
      sourceFooter(["bid", "user"]),
    ]);
  },
};
