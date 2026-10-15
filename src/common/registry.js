// 서비스 등록부 — 제품(g2b/d2b)이 시작할 때 자기 서비스 목록을 등록한다.
// 항목: { path, label, params? } — params는 모든 요청에 붙는 고정 파라미터(예: G2B의 type=json)

export const HOST = "https://apis.data.go.kr";

let services = {};

export function registerServices(map) {
  services = { ...map };
}

export function getService(id) {
  const s = services[id];
  if (!s) throw new Error(`등록되지 않은 서비스: ${id}`);
  return s;
}

export function serviceLabel(id) {
  return services[id]?.label || id;
}
