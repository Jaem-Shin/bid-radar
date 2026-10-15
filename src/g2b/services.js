// 조달청 나라장터 OpenAPI 4종 — 엔드포인트와 업무구분.
// 경로는 조달청 OpenAPI 참고자료(입찰공고 v1.2, 낙찰 v1.2)와 공개 구현에서 확인한 값.
// 사전규격·사용자정보는 명세서 원본 미확인 — 실측 시 재확인 대상.

export const SERVICES = {
  bid: {
    path: "/1230000/ad/BidPublicInfoService",
    label: "조달청 나라장터 입찰공고정보서비스",
    params: { type: "json" },
  },
  award: {
    path: "/1230000/as/ScsbidInfoService",
    label: "조달청 나라장터 낙찰정보서비스",
    params: { type: "json" },
  },
  prespec: {
    path: "/1230000/ao/HrcspSsstndrdInfoService",
    label: "조달청 나라장터 사전규격정보서비스",
    params: { type: "json" },
  },
  user: {
    path: "/1230000/ao/UsrInfoService02",
    label: "조달청 나라장터 사용자정보서비스",
    params: { type: "json" },
  },
};

// 업무구분: 사용자 표기 ↔ 오퍼레이션 접미사
export const KINDS = {
  용역: { key: "servc", suffix: "Servc" },
  공사: { key: "cnstwk", suffix: "Cnstwk" },
  물품: { key: "thng", suffix: "Thng" },
  외자: { key: "frgcpt", suffix: "Frgcpt" },
};
export const KIND_NAMES = Object.keys(KINDS);

export function resolveKinds(kind) {
  if (!kind || kind === "전체") return [...KIND_NAMES];
  if (!KINDS[kind]) throw new Error(`업무구분은 ${KIND_NAMES.join("·")}·전체 중 하나여야 합니다: ${kind}`);
  return [kind];
}
