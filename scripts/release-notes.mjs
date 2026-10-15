// 릴리스 본문 생성: node scripts/release-notes.mjs <g2b|d2b> <버전>
// 변경 내용은 CHANGELOG.md 표에서 같은 버전 줄을 가져온다.
import { readFileSync } from "node:fs";

const [product, version] = process.argv.slice(2);
const name = `${product}-bid-radar`;
const readme = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"); // 전체 내역(README에는 최신만)
const row = readme.split("\n").find((l) => l.startsWith(`| ${version} |`));
const change = row ? row.split("|")[3].trim() : "";
const latest = JSON.parse(readFileSync(new URL(`../products/${product}/manifest.json`, import.meta.url), "utf8")).version;
const old = latest !== version;

console.log(
  [
    old ? `> [!NOTE]\n> 이전 버전입니다. 새로 설치한다면 최신 버전(${latest})을 받으세요.\n` : null,
    change ? `**변경 내용**: ${change}\n` : null,
    "**새로 설치** — 아래 `" + `${name}-${version}.mcpb` + "`를 받아 Claude 데스크톱 → 설정 → 확장 프로그램 → 고급 설정 → 확장 프로그램 설치… 에서 선택하세요.",
    "",
    "**이미 설치했다면** — 자동으로 업데이트됩니다(Claude를 다시 시작하면 적용).",
    "",
    "Claude Code 등 다른 설치 방법과 사용 예시는 [README](https://github.com/Jaem-Shin/bid-radar#bid-radar)를 보세요.",
  ].filter((x) => x !== null).join("\n"),
);
