import { call, Budget, hasKey } from "../../common/client.js";
import { serviceLabel } from "../../common/registry.js";
import { describeError } from "../../common/errors.js";
import { stamp } from "../../common/dates.js";
import { versionLines } from "../../common/versionLines.js";
import { OPS } from "../services.js";

const PROBES = ["planList", "bidList", "resultList", "contractList"];

export default {
  name: "d2b_check_setup",
  title: "D2B 설정 점검",
  description: "인증키와 방위사업청 군수품조달정보 4개 서비스(조달계획·입찰공고·입찰결과·계약정보)의 활용승인 상태를 점검한다. 다른 D2B 도구가 인증·승인 오류를 낼 때 먼저 실행한다.",
  inputSchema: {},
  async run(_a, ctx) {
    if (!hasKey()) return ["[ERROR] 인증키가 설정되지 않았습니다. 공공데이터포털 '일반 인증키(Decoding)'를 확장 설정(Claude 데스크톱 → 설정 → 확장 프로그램 → D2B Bid Radar) 또는 MCP 설정의 환경변수 DATA_GO_KR_SERVICE_KEY에 넣으세요.", "", ...versionLines(ctx.config)].join("\n");
    const budget = new Budget(8);
    const lines = [`[D2B 설정 점검] ${stamp()}`];
    const res = await Promise.all(
      PROBES.map(async (k) => {
        const [svc, op] = OPS[k];
        try {
          const r = await call(svc, op, { pageNo: 1, numOfRows: 1 }, { budget });
          return `✓ ${serviceLabel(svc)} — 정상 (시설 전체 ${r.total}건)`;
        } catch (e) {
          return `✗ ${serviceLabel(svc)} — ${describeError(e)}`;
        }
      }),
    );
    lines.push(...res, "", ...versionLines(ctx.config));
    return lines.join("\n");
  },
};
