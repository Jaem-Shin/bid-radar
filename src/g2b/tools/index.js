// 도구 목록 — 새 도구는 파일을 만들고 여기 한 줄 추가하면 된다.
import check_setup from "./check_setup.js";
import search_bids from "./search_bids.js";
import bid_detail from "./bid_detail.js";
import bid_changes from "./bid_changes.js";
import bid_result from "./bid_result.js";
import search_awards from "./search_awards.js";
import search_prespecs from "./search_prespecs.js";
import company_profile from "./company_profile.js";
import { makeUpdateTool } from "../../common/updateTool.js";
import { makeKeywordsTool } from "../../common/keywordsTool.js";
import briefing from "./briefing.js";
import deadlines from "./deadlines.js";
import eligibility from "./eligibility.js";

export const tools = [
  check_setup,
  search_bids,
  bid_detail,
  bid_changes,
  bid_result,
  search_awards,
  search_prespecs,
  company_profile,
  makeKeywordsTool("g2b"),
  briefing,
  deadlines,
  eligibility,
  makeUpdateTool("g2b", "G2B Bid Radar"),
];
