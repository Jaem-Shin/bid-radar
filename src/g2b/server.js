// G2B Bid Radar — 조달청 나라장터 입찰공고·낙찰·사전규격·사용자정보 OpenAPI 조회 서버
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureClient } from "../common/client.js";
import { registerServices } from "../common/registry.js";
import { SERVICES } from "./services.js";
import { describeError } from "../common/errors.js";
import { tools } from "./tools/index.js";

export { VERSION } from "./version.js";
import { VERSION } from "./version.js";

const INSTRUCTIONS = [
  "조달청 나라장터 OpenAPI(입찰공고·낙찰·사전규격·사용자정보) 조회 서버. 모든 값은 API 원자료다.",
  "규칙: (1) 도구 결과에 없는 공고·금액·일정·업체를 지어내지 말 것. [NOT_FOUND]면 '데이터 없음'으로 보고한다.",
  "(2) '(계산)' 표시 값은 원자료로 계산한 값이니 그 표시를 유지해 전달한다. (3) '⚠ 불일치'·'조회 실패'·'일부만 표시' 경고는 생략하지 말고 사용자에게 전한다.",
  "(4) 참가 가능 여부는 판정하지 말고 원자료(면허제한·지역)를 제시한 뒤 공고서 확인을 권한다. (5) 답에 공고번호와 나라장터 링크를 함께 준다.",
  "흐름: 찾기는 g2b_search_bids/g2b_search_awards/g2b_search_prespecs → 한 건은 g2b_bid_detail(공고)·g2b_bid_result(개찰) → 인증·승인 오류면 g2b_check_setup.",
  "관심 키워드(g2b_keywords, D2B와 공통)를 저장해 두면 g2b_briefing(새 공고)·g2b_deadlines(마감 일정)가 그 키워드로 전 기관을 찾는다. 면허 대조는 g2b_eligibility(판정 기준을 그대로 전한다).",
].join("\n");

// 설치 화면에서 비워 둔 항목은 "" 또는 치환 안 된 "${user_config.x}"로 올 수 있다
function setting(v) {
  const t = String(v ?? "").trim();
  return t.startsWith("${") ? "" : t;
}

export function createServer(env = process.env, { updateInfo = null } = {}) {
  const biz = setting(env.MY_BIZNO).replace(/\D/g, "");
  const config = { myBizno: biz.length === 10 ? biz : "", updateInfo, version: VERSION };
  registerServices(SERVICES);
  configureClient({ key: setting(env.DATA_GO_KR_SERVICE_KEY) });

  const server = new McpServer({ name: "g2b-bid-radar", version: VERSION }, { instructions: INSTRUCTIONS });
  for (const t of tools) {
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly !== false, openWorldHint: true } },
      async (args) => {
        try {
          const text = await t.run(args || {}, { config });
          return { content: [{ type: "text", text }] };
        } catch (e) {
          return { isError: true, content: [{ type: "text", text: `[ERROR] ${describeError(e)}` }] };
        }
      },
    );
  }
  return server;
}
