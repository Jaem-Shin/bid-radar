// check_setup 하단의 버전·자동 업데이트 표시(제품 공통)
// 최신 실행기 번호 — launcher/config.js LAUNCHER_VERSION과 맞춘다(낮은 실행기 설치본에 재설치 안내)
const RECOMMENDED_LAUNCHER = 3;
function cmp(a, b) {
  const x = a.split(".").map(Number), y = String(b || "0.0.0").split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

export function versionLines(config) {
  const u = config.updateInfo;
  if (!u) return [`버전: ${config.version} (npx 실행 — 업데이트는 실행할 때 받아오는 코드로 반영)`];
  const out = [`버전: ${u.activeVersion} (${u.activeSource === "updated" ? "자동 업데이트본" : "설치본"}) · 실행기 ${u.launcherVersion}`];
  out.push(`자동 업데이트: ${u.autoUpdate ? "켜짐" : `꺼짐${u.autoUpdateNote ? ` (${u.autoUpdateNote})` : ""}`}`);
  if (u.lastCheck) {
    // 재설치 직후에는 이전 설치본의 확인 기록이 남아 있다 → 지금 버전보다 낮은 버전 이야기면 표시
    const mv = String(u.lastResult || "").match(/(\d+\.\d+\.\d+)/);
    const stale = mv && cmp(mv[1], u.activeVersion) < 0;
    const applied = mv && cmp(mv[1], u.activeVersion) === 0 && /다시 시작하면 적용/.test(String(u.lastResult));
    const msg = applied ? `${mv[1]} 업데이트를 받아 적용했습니다` : u.lastResult || "";
    out.push(`마지막 확인: ${u.lastCheck.replace("T", " ").slice(0, 16)} UTC — ${msg}${stale ? " (이전 설치본 때 기록)" : ""}`);
  }
  if (u.pendingVersion) out.push(`⇢ ${u.pendingVersion} 준비됨 — Claude를 다시 시작하면 적용됩니다`);
  if (u.launcherVersion < RECOMMENDED_LAUNCHER) {
    out.push("ⓘ 최신 설치 파일(.mcpb)로 한 번 다시 설치하면 '업데이트 확인해줘'로 바로 새 버전을 받을 수 있습니다(지금은 자동 확인만).");
  }
  if (u.repo) out.push(`배포: https://github.com/${u.repo}/releases`);
  return out;
}
