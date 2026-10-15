// D2B 도구 목록 — 새 도구는 파일을 만들고 여기 한 줄 추가
import check_setup from "./check_setup.js";
import search_bids from "./search_bids.js";
import bid_detail from "./bid_detail.js";
import plans from "./plans.js";
import search_results from "./search_results.js";
import bid_result from "./bid_result.js";
import contracts from "./contracts.js";
import project from "./project.js";
import raw from "./raw.js";
import { makeUpdateTool } from "../../common/updateTool.js";
import { makeKeywordsTool } from "../../common/keywordsTool.js";
import briefing from "./briefing.js";
import deadlines from "./deadlines.js";
import eligibility from "./eligibility.js";

export const tools = [
  check_setup, search_bids, bid_detail, plans, search_results, bid_result, contracts, project, makeKeywordsTool("d2b"), briefing, deadlines, eligibility, makeUpdateTool("d2b", "D2B Bid Radar"),
  // 개발자 진단 도구 — 환경변수 BR_DIAG=1일 때만(일반 설치본에는 보이지 않음)
  ...(process.env.BR_DIAG === "1" ? [raw] : []),
];
