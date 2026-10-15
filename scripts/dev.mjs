// 개발용 직접 실행(업데이트 없이): node scripts/dev.mjs <g2b|d2b>
const product = process.argv[2] || "g2b";
const { start, VERSION } = await import(`../src/${product}/core.js`);
await start();
console.error(`[${product}-bid-radar] v${VERSION} ready (dev)`);
