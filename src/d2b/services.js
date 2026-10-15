// 방위사업청 군수품조달정보 OpenAPI(_GW) 4종 — 경로·오퍼레이션은 공공데이터포털 명세(Swagger, 2026-10-15 확인).
// 응답은 XML. 날짜 파라미터 형식은 명세에 없음 → 아래 함수 한 곳에서만 만든다(실측 후 확정).

export const SERVICES = {
  plan: { path: "/1690000/PrcurePlanInfoService", label: "방위사업청 군수품조달정보 조달계획" },
  bid: { path: "/1690000/BidPblancInfoService", label: "방위사업청 군수품조달정보 입찰공고" },
  result: { path: "/1690000/BidResultInfoService", label: "방위사업청 군수품조달정보 입찰결과" },
  contract: { path: "/1690000/CntrctInfoService", label: "방위사업청 군수품조달정보 계약정보" },
  // 참가자격 점검용(선택) — 회사 등록업종. 같은 공공데이터포털 키로 조달청 사용자정보서비스 활용승인이 있어야 한다.
  user: { path: "/1230000/ao/UsrInfoService02", label: "조달청 나라장터 사용자정보서비스", params: { type: "json" } },
};

// 시설(공사·용역) 오퍼레이션
export const OPS = {
  planList: ["plan", "getFcltyPrcurePlanList"],
  planDetail: ["plan", "getFcltyPrcurePlanDetail"],
  bidList: ["bid", "getFcltyCmpetBidPblancList"],
  bidDetail: ["bid", "getFcltyCmpetBidPblancDetail"],
  negoPlanList: ["bid", "getFcltyOthbcVltrnNtatPlanList"],
  negoPlanDetail: ["bid", "getFcltyOthbcVltrnNtatPlanDetail"],
  resultList: ["result", "getFcltyCmpetBidResultList"],
  resultDetail: ["result", "getFcltyCmpetBidResultDetail"],
  resultBidders: ["result", "getFcltyCmpetBidResultMnufList"],
  resultPrices: ["result", "getFcltyCmpetBidResultBsicList"],
  negoResultList: ["result", "getFcltyOthbcVltrnNtatResultList"],
  negoResultDetail: ["result", "getFcltyOthbcVltrnNtatResultDetail"],
  contractList: ["contract", "getFcltyCntrctInfoList"],
};

// 진단 도구(d2b_raw)에서 부를 수 있는 오퍼레이션 — 명세에 있는 조회 오퍼레이션 전부
export const RAW_OPS = {
  plan: ["getDmstcPrcurePlanList", "getDmstcPrcurePlanDetail", "getOutnatnPrcurePlanDcsDtls", "getFcltyPrcurePlanList", "getFcltyPrcurePlanDetail", "getOutnatnPrcurePlanList", "getOutnatnPrcurePlanDcsDetail"],
  bid: ["getDmstcCmpetBidPblancList", "getDmstcCmpetBidPblancDetail", "getDmstcOthbcVltrnNtatPlanList", "getDmstcOthbcVltrnNtatPlanDetail", "getOutnatnCmpetBidPblancList", "getOutnatnCmpetBidPblancDetail", "getFcltyCmpetBidPblancList", "getFcltyCmpetBidPblancDetail", "getFcltyOthbcVltrnNtatPlanList", "getFcltyOthbcVltrnNtatPlanDetail", "getDmstcCmpetBidPblancItem", "getOutnatnCmpetBidPblancItem"],
  result: ["getOutnatnCmpetBidResultList", "getDmstcCmpetBidResultList", "getDmstcCmpetBidResultDetail", "getDmstcOthbcVltrnNtatResultList", "getDmstcOthbcVltrnNtatResultDetail", "getOutnatnCmpetBidResultDetail", "getOutnatnNtatResultList", "getFcltyCmpetBidResultList", "getFcltyCmpetBidResultDetail", "getFcltyOthbcVltrnNtatResultList", "getFcltyOthbcVltrnNtatResultDetail", "getDmstcCmpetBidResultMnufList", "getDmstcCmpetBidResultBsicList", "getDmstcOthbcVltrnNtatResultMnufList", "getDmstcOthbcVltrnNtatResultBsicList", "getFcltyCmpetBidResultMnufList", "getFcltyCmpetBidResultBsicList", "getFcltyOthbcVltrnNtatResultMnufList", "getFcltyOthbcVltrnNtatResultBsicList"],
  contract: ["getFcltyCntrctInfoList", "getDmstcCntrctInfoList", "getOutnatnCntrctInfoList"],
};

// 날짜 파라미터 형식(미확정 — 실측 후 여기만 고친다)
export const d2bDate = (yyyymmdd) => yyyymmdd; // 예: 20261015
export const d2bMonth = (yyyymmdd) => yyyymmdd.slice(0, 6); // 발주예정월 예: 202610
