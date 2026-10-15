// 패키지(.mcpb) 빌드 때는 products/g2b/manifest.json 버전으로 고정(scripts/build.mjs), npx 실행 때는 manifest에서 읽는다.
import { readFileSync } from "node:fs";
function fromManifest() {
  try {
    return JSON.parse(readFileSync(new URL("../../products/g2b/manifest.json", import.meta.url), "utf8")).version;
  } catch {
    return "0.0.0-dev";
  }
}
export const VERSION = typeof __PRODUCT_VERSION__ === "string" ? __PRODUCT_VERSION__ : fromManifest();
