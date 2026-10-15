import { call, Budget, hasKey } from "../../common/client.js";
import { serviceLabel } from "../../common/registry.js";
import { versionLines } from "../../common/versionLines.js";
import { describeError } from "../../common/errors.js";
import { todayYmd, addDays, stamp } from "../../common/dates.js";

// 서비스별 최소 호출(1건)로 승인 상태 확인. 데이터 0건도 '정상'(승인됨)으로 본다.
function probes(bizno) {
  const end = todayYmd();
  const bgn = addDays(end, -1);
  const range = { inqryBgnDt: `${bgn}0000`, inqryEndDt: `${end}2359` };
  return [
    ["bid", "getBidPblancListInfoServc", { inqryDiv: 1, ...range }],
    ["award", "getScsbidListSttusServc", { inqryDiv: 1, ...range }],
    ["prespec", "getPublicPrcureThngInfoServc", { inqryDiv: 1, ...range }],
    ["user", "getPrcrmntCorpBasicInfo02", { inqryDiv: 3, bizno: bizno || "0000000000" }],
  ];
}

export default {
  name: "g2b_check_setup",
  title: "설정 점검",
  description:
    "인증키와 4개 서비스(입찰공고·낙찰·사전규격·사용자정보)의 활용승인 상태를 점검한다. 다른 도구가 인증·승인 오류를 낼 때 먼저 실행한다.",
  inputSchema: {},
  async run(_args, ctx) {
    if (!hasKey()) {
      return ["[ERROR] 인증키가 설정되지 않았습니다. 공공데이터포털 '일반 인증키(Decoding)'를 확장 설정(Claude 데스크톱 → 설정 → 확장 프로그램 → G2B Bid Radar) 또는 MCP 설정의 환경변수 DATA_GO_KR_SERVICE_KEY에 넣으세요.", "", ...versionLines(ctx.config)].join("\n");
    }
    const budget = new Budget(8);
    const lines = [`[설정 점검] ${stamp()}`];
    const results = await Promise.all(
      probes(ctx.config.myBizno).map(async ([svc, op, params]) => {
        try {
          const r = await call(svc, op, { ...params, pageNo: 1, numOfRows: 1 }, { budget });
          return `✓ ${serviceLabel(svc)} — 정상 ${svc === "user" ? "(승인 확인)" : `(최근 1일 ${r.total}건)`}`;
        } catch (e) {
          return `✗ ${serviceLabel(svc)} — ${describeError(e)}`;
        }
      }),
    );
    lines.push(...results);
    lines.push(ctx.config.myBizno ? `회사 사업자번호: ${ctx.config.myBizno.replace(/^(\d{3})(\d{2})(\d{5})$/, "$1-$2-$3")}` : "회사 사업자번호: 미설정 (g2b_company_profile·우리 회사 표시 기능에 필요)");
    lines.push("", ...versionLines(ctx.config));
    return lines.join("\n");
  },
};
