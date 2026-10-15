#!/usr/bin/env node
// npx 실행용:  npx -y github:Jaem-Shin/bid-radar g2b   (또는 d2b)
// 환경변수: DATA_GO_KR_SERVICE_KEY(필수), MY_BIZNO(선택)
const product = (process.argv[2] || "").toLowerCase();
if (!["g2b", "d2b"].includes(product)) {
  console.error("사용법: bid-radar <g2b|d2b>   (환경변수 DATA_GO_KR_SERVICE_KEY 필요)");
  process.exit(1);
}
const { start, VERSION } = await import(`../src/${product}/core.js`);
await start();
console.error(`[${product}-bid-radar] v${VERSION} ready`);
