import { z } from "zod";
import { Budget, callAll } from "../../common/client.js";
import { KINDS } from "../services.js";
import { parseBidNo, findNotice, pickOrder } from "../lookup.js";
import { describeError } from "../../common/errors.js";
import { val, won, wonPlain, pct, when, has, line, joinLines, g2bLink, sourceFooter, filePairs, caretList, num, NOT_FOUND, officer } from "../../common/format.js";
import { KIND_ENUM } from "./search_bids.js";

const KIND_ONLY = KIND_ENUM.exclude(["전체"]);

// 공고번호 기준 보조 오퍼레이션 — 실패해도 카드는 낸다(섹션에 실패 표시)
async function side(op, params, budget) {
  try {
    const r = await callAll("bid", op, params, { maxRows: 100, budget });
    return { ok: true, items: r.items };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}

function section(title, rows) {
  const body = joinLines(rows);
  return body ? `\n◆ ${title}\n${body}` : "";
}

export default {
  name: "g2b_bid_detail",
  title: "입찰공고 종합카드",
  description:
    "입찰공고번호 하나로 공고 원문 정보(기관·방식·금액·일정)와 기초금액, 면허(업종)제한, 참가가능지역, 첨부파일, 연결번호를 한 카드로 보여준다. " +
    "취소·변경공고는 맨 위에 표시하고, 같은 항목이 오퍼레이션마다 다르면 '불일치'로 표시한다. 참가 가능 여부를 판정하지는 않는다(원자료만 제시).",
  inputSchema: {
    bid_no: z.string().describe("입찰공고번호 (예: R25BK00933736, R25BK00933736-000, 또는 나라장터 공고 링크)"),
    order: z.string().optional().describe("입찰공고차수 (기본: 가장 최근 차수)"),
    kind: KIND_ONLY.optional().describe("업무구분을 알면 지정(호출 절약)"),
  },
  async run(a) {
    const { no, ord } = parseBidNo(a.bid_no, a.order);
    const budget = new Budget(30);
    const found = await findNotice(no, { kind: a.kind, budget });
    if (!found.kind) {
      return joinLines([
        `${NOT_FOUND} 입찰공고번호 ${no}를 입찰공고정보서비스(${a.kind || "용역·공사·물품·외자"})에서 찾지 못했습니다.`,
        found.errors.length ? `조회 오류: ${found.errors.join(" / ")}` : null,
        "번호를 다시 확인하거나, 자체전자조달시스템 공고(국방전자조달 등)인지 확인하세요.",
        sourceFooter(["bid"]),
      ]);
    }
    const { chosen: it, all } = pickOrder(found.items, ord);
    if (!it) {
      return `${NOT_FOUND} ${no}의 차수 ${ord}가 없습니다. 존재하는 차수: ${all.map((x) => val(x.bidNtceOrd)).join(", ")}`;
    }
    const kind = found.kind;
    const sfx = KINDS[kind].suffix;
    const o = val(it.bidNtceOrd) || "000";
    const byNo = { inqryDiv: 2, bidNtceNo: no };
    const byNoOrd = { inqryDiv: 2, bidNtceNo: no, bidNtceOrd: o };

    const [basis, license, region, eorder, mfrc] = await Promise.all([
      kind === "외자" ? Promise.resolve({ ok: true, items: [], na: true }) : side(`getBidPblancListInfo${sfx}BsisAmount`, byNo, budget),
      side("getBidPblancListInfoLicenseLimit", byNoOrd, budget),
      side("getBidPblancListInfoPrtcptPsblRgn", byNoOrd, budget),
      side("getBidPblancListInfoEorderAtchFileInfo", byNo, budget),
      kind === "공사" ? side("getBidPblancListEvaluationIndstrytyMfrcInfo", byNo, budget) : Promise.resolve({ ok: true, items: [], na: true }),
    ]);
    const sameOrd = (x) => (val(x.bidNtceOrd) || "000") === o;

    // ── 상태 경고
    const status = val(it.ntceKindNm);
    const warnings = [];
    if (/취소/.test(status)) warnings.push(`⚠ 취소공고입니다. 사유: ${val(it.chgNtceRsn) || "(API에 사유 없음)"}`);
    else if (/변경/.test(status)) warnings.push(`ⓘ 변경공고입니다. 사유: ${val(it.chgNtceRsn) || "(API에 사유 없음)"} — 변경 내역은 g2b_bid_changes로 확인`);
    if (val(it.reNtceYn) === "Y") warnings.push(`ⓘ 재공고입니다.${has(it.befBidBbancNo) ? ` 이전 공고번호 ${val(it.befBidBbancNo)}` : ""}`);
    if (all.length > 1) warnings.push(`ⓘ 이 공고는 차수가 ${all.length}개입니다(${all.map((x) => val(x.bidNtceOrd)).join(", ")}). 표시는 차수 ${o}.`);

    // ── 교차대조: 같은 항목이 두 오퍼레이션에 있으면 비교
    const checks = [];
    const basisRow = basis.ok ? basis.items.filter(sameOrd)[0] || basis.items[0] : null;
    if (basisRow && has(basisRow.bidNtceNm) && val(basisRow.bidNtceNm) !== val(it.bidNtceNm)) {
      checks.push(`⚠ 불일치: 공고명이 기초금액 응답과 다릅니다 (공고: "${val(it.bidNtceNm)}" / 기초금액: "${val(basisRow.bidNtceNm)}")`);
    }
    const mfrcRows = mfrc.ok ? mfrc.items.filter(sameOrd) : [];
    const mfrcPrice = mfrcRows.map((r) => num(r.presmptPrce)).find((x) => x !== null);
    if (mfrcPrice != null && num(it.presmptPrce) != null && mfrcPrice !== num(it.presmptPrce) && mfrcRows.length === 1) {
      checks.push(`⚠ 불일치: 추정가격이 평가대상주력분야 응답과 다릅니다 (공고 ${wonPlain(it.presmptPrce)} / 주력분야 ${wonPlain(mfrcPrice)})`);
    }

    const instLine = [val(it.ntceInsttNm), has(it.dminsttNm) && val(it.dminsttNm) !== val(it.ntceInsttNm) ? `수요기관 ${val(it.dminsttNm)}` : ""].filter(Boolean).join(" / ");
    const evalRatio = has(it.techAbltEvlRt) || has(it.bidPrceEvlRt) ? `기술 ${val(it.techAbltEvlRt) || "-"} : 가격 ${val(it.bidPrceEvlRt) || "-"}` : "";

    const files = filePairs(it, "ntceSpecFileNm", "ntceSpecDocUrl");
    const eorderFiles = eorder.ok ? eorder.items.filter(sameOrd).map((f) => ({ name: `${val(f.eorderDocDivNm) ? `[${val(f.eorderDocDivNm)}] ` : ""}${val(f.eorderAtchFileNm)}`, url: val(f.eorderAtchFileUrl).replace(/\s+/g, "") })) : [];

    const licenseRows = license.ok ? license.items.filter(sameOrd) : [];
    const groups = {};
    for (const l of licenseRows) {
      const g = val(l.lmtGrpNo) || "?";
      (groups[g] ||= []).push(l);
    }
    const regionRows = region.ok ? region.items.filter(sameOrd) : [];

    const out = [
      `[입찰공고 종합카드] ${val(it.bidNtceNm)}`,
      `공고번호 ${no}-${o} · ${kind}${status ? ` · ${status}` : ""}`,
      ...warnings,
      ...checks,
      section("기본", [
        line("기관", instLine),
        line("계약방법", val(it.cntrctCnclsMthdNm)),
        line("입찰방식", val(it.bidMethdNm)),
        line("낙찰방법", [val(it.sucsfbidMthdNm), val(it.sucsfbidMthdAppStd)].filter(Boolean).join(" · ")),
        line("평가비율", evalRatio),
        line("용역구분", val(it.srvceDivNm)),
        line("공동수급", val(it.cmmnSpldmdMethdNm)),
        line("국제입찰", val(it.intrbidYn) === "Y" ? "예" : ""),
        line("공공조달분류", [val(it.pubPrcrmntLrgClsfcNm), val(it.pubPrcrmntMidClsfcNm), val(it.pubPrcrmntClsfcNm)].filter(Boolean).join(" > ")),
        line("담당", officer(it.ntceInsttOfclNm)),
      ]),
      section("금액", [
        line("배정예산", won(it.asignBdgtAmt)),
        line("추정가격", won(it.presmptPrce)),
        line("부가가치세", won(it.VAT)),
        basis.na ? null : basis.ok ? (basisRow ? line("기초금액", `${won(basisRow.bssamt)}${has(basisRow.bssamtOpenDt) ? ` (공개 ${val(basisRow.bssamtOpenDt)})` : ""}`) : "  기초금액: 아직 공개되지 않았거나 API에 없음") : `  기초금액: 조회 실패 — ${basis.error}`,
        basisRow && (has(basisRow.rsrvtnPrceRngBgnRate) || has(basisRow.rsrvtnPrceRngEndRate)) ? line("예비가격 범위", `${val(basisRow.rsrvtnPrceRngBgnRate)} ~ ${val(basisRow.rsrvtnPrceRngEndRate)}%`) : null,
        basisRow ? line("기초금액 비고", [val(basisRow.rmrk1), val(basisRow.rmrk2)].filter(Boolean).join(" / ")) : null,
        line("예정가격 결정", [val(it.prearngPrceDcsnMthdNm), has(it.totPrdprcNum) ? `총 ${val(it.totPrdprcNum)}개 중 ${val(it.drwtPrdprcNum)}개 추첨` : ""].filter(Boolean).join(" · ")),
        line("낙찰하한율", pct(it.sucsfbidLwltRate)),
      ]),
      section("일정 (D-day는 계산값)", [
        line("공고", val(it.bidNtceDt)),
        line("설명회", [when(it.dcmtgOprtnDt), val(it.dcmtgOprtnPlce)].filter(Boolean).join(" · ")),
        line("PQ 신청마감", when(it.pqApplDocRcptDt)),
        line("실적신청 마감", when(it.arsltReqstdocRcptDt)),
        line("TP 신청마감", when(it.tpEvalApplClseDt)),
        line("입찰참가자격 등록마감", when(it.bidQlfctRgstDt)),
        line("공동수급협정 마감", when(it.cmmnSpldmdAgrmntClseDt)),
        line("입찰개시", val(it.bidBeginDt)),
        line("입찰마감", when(it.bidClseDt)),
        line("개찰", [val(it.opengDt), val(it.opengPlce)].filter(Boolean).join(" · ")),
      ]),
      section("참가자격 원자료 (판정 아님 — 공고서로 확인)", [
        line("업종제한", val(it.indstrytyLmtYn) === "Y" ? "있음" : val(it.indstrytyLmtYn) === "N" ? "없음" : ""),
        license.ok
          ? licenseRows.length
            ? Object.entries(groups).map(([g, ls]) => `  면허제한 그룹 ${g}: ${ls.map((l) => val(l.lcnsLmtNm)).filter(Boolean).join(", ") || "-"}${ls.some((l) => has(l.permsnIndstrytyList)) ? ` | 허용업종 ${ls.map((l) => caretList(l.permsnIndstrytyList).map((x) => x.join(" ")).join(", ")).filter(Boolean).join(", ")}` : ""}`).join("\n")
            : "  면허제한: API 결과 없음"
          : `  면허제한: 조회 실패 — ${license.error}`,
        region.ok ? line("참가가능지역", regionRows.map((r) => val(r.prtcptPsblRgnNm)).filter(Boolean).join(", ") || "API 결과 없음") : `  참가가능지역: 조회 실패 — ${region.error}`,
        line("공동도급 의무지역", [val(it.jntcontrctDutyRgnNm1), val(it.jntcontrctDutyRgnNm2), val(it.jntcontrctDutyRgnNm3)].filter(Boolean).join(", ") + (has(it.rgnDutyJntcontrctRt) && val(it.rgnDutyJntcontrctRt) !== "0" ? ` (하한 ${val(it.rgnDutyJntcontrctRt)}%)` : "")),
        line("지역제한 판단기준", val(it.rgnLmtBidLocplcJdgmBssNm)),
        line("지사투찰 허용", val(it.brffcBidprcPermsnYn) === "Y" ? "예" : val(it.brffcBidprcPermsnYn) === "N" ? "아니오" : ""),
        mfrcRows.length ? `  평가대상 주력분야: ${mfrcRows.map((r) => [val(r.CnsttyTyNm), val(r.tmpNm), val(r.IndstrytyMfrcFldNm)].filter(Boolean).join(" ")).join(" / ")}` : null,
        "  ※ 면허제한 그룹 간·그룹 내 충족 조건(AND/OR)은 공고서 기준으로 확인하세요.",
      ]),
      section("첨부", [
        ...files.map((f) => `  ${f.name}${f.url ? `\n    ${f.url}` : ""}`),
        has(it.stdNtceDocUrl) ? `  표준공고서\n    ${val(it.stdNtceDocUrl).replace(/\s+/g, "")}` : null,
        ...eorderFiles.map((f) => `  ${f.name}${f.url ? `\n    ${f.url}` : ""}`),
        eorder.ok ? null : `  e발주 첨부: 조회 실패 — ${eorder.error}`,
      ]),
      section("연결 번호", [
        line("사전규격등록번호", val(it.bfSpecRgstNo)),
        line("발주계획통합번호", val(it.orderPlanUntyNo)),
        line("통합공고번호", val(it.untyNtceNo)),
        line("참조번호", val(it.refNo)),
      ]),
      "",
      `나라장터 원문: ${val(it.bidNtceDtlUrl).replace(/\s+/g, "") || g2bLink(no, o)}`,
      sourceFooter(["bid"]),
    ];
    return joinLines(out);
  },
};
