// 제품별 빌드: node scripts/build.mjs <g2b|d2b|all> [--pack]
// 산출물: out/<제품>/bundle/{manifest.json, icon.png, LICENSE, server/index.mjs(실행기), server/core.mjs(서버)}
//        out/<제품>/dist/{core.mjs, release.json[, <이름>-<버전>.mcpb]}
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { LAUNCHER_VERSION, CORE_MIN_LAUNCHER, PUBKEY } from "../launcher/config.js";

const PRODUCTS = ["g2b", "d2b"];
const arg = process.argv[2] || "all";
const pack = process.argv.includes("--pack");
const targets = arg === "all" ? PRODUCTS : [arg];
if (!targets.every((t) => PRODUCTS.includes(t))) {
  console.error(`사용법: node scripts/build.mjs <${PRODUCTS.join("|")}|all> [--pack]`);
  process.exit(1);
}

const requireShim = "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);";

for (const product of targets) {
  const manifest = JSON.parse(readFileSync(`products/${product}/manifest.json`, "utf8"));
  const { version, name } = manifest;
  const out = join("out", product);
  const bundle = join(out, "bundle");
  const dist = join(out, "dist");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(bundle, "server"), { recursive: true });
  mkdirSync(dist, { recursive: true });

  const define = {
    __PRODUCT__: JSON.stringify(product),
    __PRODUCT_NAME__: JSON.stringify(name),
    __PRODUCT_VERSION__: JSON.stringify(version),
    __BUNDLED_VERSION__: JSON.stringify(version),
  };

  await build({
    entryPoints: [`src/${product}/core.js`],
    outfile: join(bundle, "server", "core.mjs"),
    bundle: true, platform: "node", format: "esm", target: "node18",
    banner: { js: requireShim }, define, legalComments: "none", logLevel: "warning",
  });
  await build({
    entryPoints: ["launcher/index.js"],
    outfile: join(bundle, "server", "index.mjs"),
    bundle: true, platform: "node", format: "esm", target: "node18",
    define, logLevel: "warning",
  });

  manifest.server.entry_point = "server/index.mjs";
  manifest.server.mcp_config.args = ["${__dirname}/server/index.mjs"];
  writeFileSync(join(bundle, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  copyFileSync(`products/${product}/icon.png`, join(bundle, "icon.png"));
  copyFileSync("LICENSE", join(bundle, "LICENSE"));

  copyFileSync(join(bundle, "server", "core.mjs"), join(dist, "core.mjs"));
  const sha256 = createHash("sha256").update(readFileSync(join(dist, "core.mjs"))).digest("hex");
  const release = { name, version, sha256, minLauncher: CORE_MIN_LAUNCHER, commit: process.env.GITHUB_SHA || "" };
  writeFileSync(join(dist, "release.json"), JSON.stringify(release, null, 2) + "\n");
  writeFileSync(join(dist, "latest.json"), JSON.stringify({ version }) + "\n");

  if (pack) {
    const mcpb = existsSync("node_modules/.bin/mcpb") ? "node_modules/.bin/mcpb" : "mcpb";
    execFileSync(mcpb, ["validate", join(bundle, "manifest.json")], { stdio: "inherit" });
    execFileSync(mcpb, ["pack", bundle, join(dist, `${name}-${version}.mcpb`)], { stdio: ["ignore", "ignore", "inherit"] });
  }
  console.log(`${name} ${version} · core ${sha256.slice(0, 12)}… · 실행기 ${LAUNCHER_VERSION} · 서명키 ${PUBKEY ? "있음" : "없음(자동 업데이트 꺼짐)"}${pack ? " · .mcpb 생성" : ""}`);
}
