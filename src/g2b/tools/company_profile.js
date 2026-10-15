import { z } from "zod";
import { Budget, callAll } from "../../common/client.js";
import { describeError, ApiError } from "../../common/errors.js";
import { todayYmd } from "../../common/dates.js";
import { val, has, joinLines, sourceFooter, NOT_FOUND } from "../../common/format.js";

async function facet(op, params, budget) {
  try {
    const r = await callAll("user", op, params, { maxRows: 500, budget });
    return { ok: true, items: r.items, truncated: r.truncated, total: r.total };
  } catch (e) {
    if (e instanceof ApiError && ["auth", "access", "quota"].includes(e.kind)) throw e;
    return { ok: false, items: [], error: describeError(e) };
  }
}

// 업종 유효 여부(계산): 만료일이 오늘 이전이거나 상태명이 '유효기간 경과'면 만료
function industryState(row, today) {
  const exp = val(row.vldPrdExprtDt).replace(/\D/g, "").slice(0, 8);
  const st = val(row.indstrytyStatsNm);
  if (/경과|말소|취소|정지/.test(st)) return `⚠ ${st}`;
  if (exp && exp.length === 8 && exp < today) return "⚠ 유효기간 지남 (계산)";
  return st || "";
}

export default {
  name: "g2b_company_profile",
  title: "조달업체 정보",
  description:
    "나라장터 조달업체를 사업자번호로 조회한다: 업체 기본정보(상호·소재지·등록일), 등록업종(상태·유효기간), 부정당제재 이력. " +
    "사업자번호를 생략하면 설정된 회사 사업자번호를 쓴다. 대표자명·전화번호는 출력하지 않는다.",
  inputSchema: {
    bizno: z.string().optional().describe("사업자번호 10자리(하이픈 무관). 생략 시 설정된 회사 번호"),
  },
  async run(a, ctx) {
    const bizno = String(a.bizno || ctx.config.myBizno || "").replace(/\D/g, "");
    if (bizno.length !== 10) return "[ERROR] 사업자번호 10자리가 필요합니다. 인자로 주거나 확장 설정(또는 환경변수 MY_BIZNO)에 회사 사업자번호를 넣으세요.";
    const budget = new Budget(20);
    const [basic, ind, sanc] = await Promise.all([
      facet("getPrcrmntCorpBasicInfo02", { inqryDiv: 3, bizno }, budget),
      facet("getPrcrmntCorpIndstrytyInfo02", { inqryDiv: 1, bizno }, budget),
      facet("getUnptRsttCorpInfo02", { inqryDiv: 1, bizno }, budget),
    ]);
    const disp = `${bizno.slice(0, 3)}-${bizno.slice(3, 5)}-${bizno.slice(5)}`;
    const b = basic.items.find((x) => val(x.bizno).replace(/\D/g, "") === bizno) || null;
    if (basic.ok && !b && ind.ok && !ind.items.length) {
      return joinLines([`${NOT_FOUND} 사업자번호 ${disp}로 등록된 나라장터 조달업체가 없습니다.`, sourceFooter(["user"])]);
    }
    const today = todayYmd();
    const inds = ind.items.filter((x) => !has(x.bizno) || val(x.bizno).replace(/\D/g, "") === bizno);
    const sancs = sanc.items.filter((x) => !has(x.bizno) || val(x.bizno).replace(/\D/g, "") === bizno);
    const isMine = ctx.config.myBizno && ctx.config.myBizno === bizno;
    const out = [
      `[조달업체 정보] ${b ? val(b.corpNm) : "(기본정보 없음)"} · ${disp}${isMine ? " (설정된 우리 회사)" : ""}`,
      "",
      "◆ 기본정보",
      basic.ok
        ? b
          ? joinLines([
              has(b.corpBsnsDivNm) ? `  업체구분: ${val(b.corpBsnsDivNm)}` : null,
              has(b.hdoffceDivNm) ? `  본사/지사: ${val(b.hdoffceDivNm)}` : null,
              `  소재지: ${(val(b.adrs).startsWith(val(b.rgnNm)) ? val(b.adrs) : [val(b.rgnNm), val(b.adrs)].filter(Boolean).join(" ")) || "-"}`,
              has(b.opbizDt) ? `  개업일: ${val(b.opbizDt)}` : null,
              has(b.rgstDt) ? `  나라장터 등록일: ${val(b.rgstDt)}` : null,
              has(b.chgDt) ? `  최종 변경일: ${val(b.chgDt)}` : null,
            ])
          : "  API 결과 없음"
        : `  조회 실패 — ${basic.error}`,
      "",
      `◆ 등록업종${ind.ok ? ` ${inds.length}건${ind.truncated ? " (일부)" : ""}` : ""}`,
      ind.ok
        ? inds.length
          ? inds
              .map((x) => {
                const st = industryState(x, today);
                return `  ${val(x.indstrytyNm) || "(업종명 API에 없음)"} (코드 ${val(x.indstrytyCd) || "-"})${val(x.rprsntIndstrytyYn) === "Y" ? " [대표]" : ""}${has(x.vldPrdExprtDt) ? ` · 유효기간 ~${val(x.vldPrdExprtDt)}` : ""}${st ? ` · ${st}` : ""}`;
              })
              .join("\n")
          : "  API 결과 없음"
        : `  조회 실패 — ${ind.error}`,
      "",
      "◆ 부정당제재",
      sanc.ok
        ? sancs.length
          ? sancs
              .map((x) => `  ${val(x.rsttBgnDate) || "?"} ~ ${val(x.rsttEndDate) || "?"} · ${val(x.insttNm) || "-"} · ${[val(x.lawordNm), val(x.lawordArtclClause)].filter(Boolean).join(" ")}${has(x.rsttProgrsNm) ? ` · ${val(x.rsttProgrsNm)}` : ""}`)
              .join("\n")
          : "  이력 없음 (API 결과 0건)"
        : `  조회 실패 — ${sanc.error}`,
      sourceFooter(["user"]),
    ];
    return joinLines(out);
  },
};
