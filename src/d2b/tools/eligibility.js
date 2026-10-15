import { z } from "zod";
import { Budget } from "../../common/client.js";
import { describeError } from "../../common/errors.js";
import { val, joinLines, sourceFooter, NOT_FOUND } from "../../common/format.js";
import { companyIndustries, holds } from "../../common/eligibility.js";
import { d2b, splitList, d2bBidLink, d2bNegoLink, D2B_NOTE } from "../lib.js";
import { locateD2bNotice } from "./bid_detail.js";

// "[3588] 엔지니어링사업(토질, 지질)" → { code, name }
export function parseD2bLicense(s) {
  const m = String(s).match(/\[(\d{3,4})\]\s*(.*)$/);
  return m ? { code: m[1].padStart(4, "0"), name: m[2].trim() } : { code: "", name: String(s).trim() };
}

export default {
  name: "d2b_eligibility",
  title: "D2B 참가자격(면허) 점검",
  description:
    "D2B 시설 공고 1건의 면허 제한 목록을 회사 등록업종(조달청 사용자정보 — 같은 키로 활용승인 필요)과 대조해 면허별 보유 여부를 보여준다. " +
    "D2B API는 면허 그룹(모두 필요/하나만)을 주지 않아, 모두 보유·모두 미보유일 때만 판정하고 일부 보유는 '원문 확인'으로 둔다.",
  inputSchema: {
    bid_no: z.string().describe("D2B 공고번호"),
    order: z.string().optional().describe("공고차수"),
    keyword: z.string().optional().describe("공사명 일부 — 주면 찾기가 빨라짐"),
    bizno: z.string().optional().describe("사업자번호 10자리(생략 시 설정된 회사)"),
  },
  async run(a, { config }) {
    const bizno = String(a.bizno || config.myBizno || "").replace(/\D/g, "");
    if (bizno.length !== 10) return "[ERROR] 사업자번호 10자리가 필요합니다. 인자로 주거나 확장 설정(또는 환경변수 MY_BIZNO)에 회사 사업자번호를 넣으세요.";
    const budget = new Budget(60);
    const { no, ord, kind, it, closed } = await locateD2bNotice(a, budget);
    if (!it) return joinLines([`${NOT_FOUND} D2B 공고번호 ${no}${ord ? `-${ord}` : ""}를 찾지 못했습니다.`, sourceFooter(["bid"], [D2B_NOTE])]);
    let d = closed;
    if (!d) {
      try {
        const r = kind.startsWith("경쟁")
          ? await d2b("bidDetail", { pblancYear: val(it.pblancYear), pblancSeCode: val(it.pblancSeCode), pblancNo: val(it.pblancNo), pblancOdr: val(it.pblancOdr), cntrwkNo: val(it.cntrwkNo), orntCode: val(it.orntCode) }, { budget })
          : await d2b("negoPlanDetail", { orntCode: val(it.orntCode), cntrwkNo: val(it.cntrwkNo), ntatPlanDate: val(it.ntatPlanDate), pblancNo: val(it.pblancNo), pblancOdr: val(it.pblancOdr) }, { budget });
        d = r.items[0] || null;
      } catch (e) {
        return joinLines([`⚠ 공고 상세 조회 실패: ${describeError(e)}`, sourceFooter(["bid"], [D2B_NOTE])]);
      }
    }
    const x = { ...it, ...(d || {}) };
    const disp = `${bizno.slice(0, 3)}-${bizno.slice(3, 5)}-${bizno.slice(5)}`;
    const head = [
      `[D2B 참가자격 점검] ${val(x.cntrwkNm)}`,
      `공고번호 ${val(x.pblancNo)}-${val(x.pblancOdr)} · ${kind} · ${val(x.ornt) || "-"}`,
      `업체 ${disp}${config.myBizno === bizno ? " — 설정된 우리 회사" : ""}`,
      "",
    ];
    const lic = splitList(x.lcnsLmttList).map(parseD2bLicense);
    if (!lic.length) return joinLines([...head, "판정: 면허 제한 없음(API 기준) — 다른 자격은 공고서 확인", sourceFooter(["bid"], [D2B_NOTE])]);
    const ind = await companyIndustries(bizno, { budget });
    if (!ind.ok) return joinLines([...head, `⚠ 회사 등록업종 조회 실패: ${ind.error} — 같은 인증키로 '조달청 나라장터 사용자정보서비스' 활용승인이 필요합니다.`, sourceFooter(["bid"], [D2B_NOTE])]);
    if (!ind.codes.size) return joinLines([...head, `${NOT_FOUND} 사업자번호 ${disp}의 나라장터 등록업종이 없습니다.`, sourceFooter(["bid", "user"], [D2B_NOTE])]);
    const marks = lic.map((l) => ({ ...l, mark: l.code ? holds(ind.codes, l.code) : "?" }));
    const okN = marks.filter((m) => m.mark === "✓").length;
    const verdict =
      lic.length === 1 ? (okN ? "✓ 면허 보유" : "✗ 면허 미보유")
      : okN === lic.length ? "✓ 공고 면허를 모두 보유"
      : okN === 0 ? "✗ 공고 면허 중 보유한 것 없음"
      : "△ 일부만 보유 — 면허 그룹 구성(모두 필요/하나만)이 API에 없어 판정 보류. 원문 공고서의 '공종 및 면허제한'을 확인하세요.";
    const link = kind.startsWith("경쟁") ? d2bBidLink(x) : d2bNegoLink(x);
    return joinLines([
      ...head,
      `판정: ${verdict}`,
      "",
      "◆ 면허 대조 — ✓ 보유 · ✗ 미보유 · ⚠ 보유했지만 만료·상태 확인",
      ...marks.map((m) => `  ${m.mark} ${m.name || "-"}[${m.code || "?"}]`),
      "",
      "◆ 지역 제한: D2B API에서 제공하지 않음 — 원문에서 확인",
      "※ D2B 면허 코드는 나라장터 업종코드와 같은 체계로 대조했습니다. 실적·기술인력 등 다른 자격은 들어 있지 않습니다.",
      link ? `D2B 원문: ${link}` : null,
      sourceFooter(["bid", "user"], [D2B_NOTE]),
    ]);
  },
};
