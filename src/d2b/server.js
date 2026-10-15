// D2B Bid Radar — 방위사업청 국방전자조달(D2B) 군수품조달정보 조달계획·입찰공고·입찰결과·계약정보 조회 서버
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureClient } from "../common/client.js";
import { registerServices } from "../common/registry.js";
import { describeError } from "../common/errors.js";
import { SERVICES } from "./services.js";
import { tools } from "./tools/index.js";
import { VERSION } from "./version.js";

export { VERSION };

const INSTRUCTIONS = [
  "방위사업청 국방전자조달시스템(D2B) 군수품조달정보 OpenAPI(조달계획·입찰공고·입찰결과·계약정보) 조회 서버. 시설(공사·용역) 중심. 모든 값은 API 원자료다.",
  "규칙: (1) 도구 결과에 없는 공고·금액·일정·업체를 지어내지 말 것. [NOT_FOUND]면 '데이터 없음'으로 보고한다.",
  "(2) '(계산)' 표시를 유지하고, '⚠ 불일치'·'조회 실패'·'일부만' 경고는 생략하지 말고 전한다. (3) 참가 가능 여부는 판정하지 말고 원자료(면허·지역 제한)를 제시한다.",
  "(4) 답에 D2B 공고번호(또는 공사번호·발주기관코드)를 함께 준다.",
  "흐름: d2b_search_bids/d2b_plans/d2b_search_results/d2b_contracts로 찾기 → d2b_bid_detail·d2b_bid_result로 한 건 → d2b_project로 공사번호 기준 계획~계약 연혁. 오류면 d2b_check_setup.",
  "관심 키워드(d2b_keywords, G2B와 공통)를 저장해 두면 d2b_briefing(새 공고)·d2b_deadlines(마감 일정)가 그 키워드로 전 기관을 찾는다. 면허 대조는 d2b_eligibility(일부 보유면 판정 보류를 그대로 전한다).",
].join("\n");

function setting(v) {
  const t = String(v ?? "").trim();
  return t.startsWith("${") ? "" : t;
}

export function createServer(env = process.env, { updateInfo = null } = {}) {
  const biz = setting(env.MY_BIZNO).replace(/\D/g, "");
  const config = { myBizno: biz.length === 10 ? biz : "", updateInfo, version: VERSION };
  registerServices(SERVICES);
  configureClient({ key: setting(env.DATA_GO_KR_SERVICE_KEY) });

  const server = new McpServer({ name: "d2b-bid-radar", version: VERSION }, { instructions: INSTRUCTIONS });
  for (const t of tools) {
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly !== false, openWorldHint: true } },
      async (args) => {
        try {
          return { content: [{ type: "text", text: await t.run(args || {}, { config }) }] };
        } catch (e) {
          return { isError: true, content: [{ type: "text", text: `[ERROR] ${describeError(e)}` }] };
        }
      },
    );
  }
  return server;
}
