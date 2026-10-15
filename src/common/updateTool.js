// 수동 업데이트 도구(제품 공통) — 실행기(launcher)가 넘겨준 updateInfo.checkNow()를 부른다.
import { joinLines } from "./format.js";
import { versionLines } from "./versionLines.js";

export function makeUpdateTool(prefix, label) {
  return {
    name: `${prefix}_update`,
    title: `${label} 업데이트 확인`,
    readOnly: false, // 받은 업데이트를 이 PC에 저장한다
    description:
      `${label} 확장의 새 버전을 지금 확인해서 받아 둔다(개발자 서명 검증). 받은 버전은 Claude를 다시 시작하면 적용된다. ` +
      "사용자가 업데이트 확인·설치를 요청할 때만 쓴다.",
    inputSchema: {},
    async run(_a, { config }) {
      const u = config.updateInfo;
      if (!u) return "이 실행 방식(npx·개발 실행)은 자체 업데이트를 하지 않습니다. npx는 실행할 때 저장소의 최신 코드를 받습니다.";
      if (typeof u.checkNow !== "function") {
        return joinLines([
          `이 설치본(실행기 ${u.launcherVersion})은 수동 업데이트를 지원하지 않습니다. Releases의 최신 .mcpb로 한 번 다시 설치하세요.`,
          "그 전까지는 자동 확인(켤 때·6시간마다)으로 받습니다.",
          "",
          ...versionLines(config),
        ]);
      }
      const r = await u.checkNow();
      const head =
        !r ? "업데이트 확인을 하지 못했습니다(다른 확인이 진행 중이었을 수 있음). 잠시 뒤 다시 시도하세요."
        : r.status === "updated" ? `✓ ${r.version} 업데이트를 받았습니다. Claude를 완전히 종료했다가 다시 켜면 적용됩니다.`
        : r.status === "latest" ? `✓ ${r.message}`
        : `업데이트하지 않았습니다: ${r.message}`;
      return joinLines([`[${label} 업데이트 확인]`, head, "", ...versionLines(config)]);
    },
  };
}
