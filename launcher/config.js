// 자기 업데이트 설정(제품 공통) — 이 파일이 바뀌면 실행기(launcher)를 다시 배포해야 한다(.mcpb 재설치).

// 실행기 번호. 업데이트 서버(core.mjs)가 더 높은 실행기를 요구하면(minLauncher) 자동 업데이트하지 않는다.
// 2: 시작할 때 업데이트를 확인해 바로 적용
// 3: 수동 업데이트(updateInfo.checkNow) 제공, 시작 시 확인 간격 6시간
export const LAUNCHER_VERSION = 3;

// 이번 core.mjs가 요구하는 최소 실행기 번호(release.json의 minLauncher).
// core가 실행기의 새 기능을 쓸 때만 올린다 — 올리면 그보다 낮은 실행기 설치본은 .mcpb를 다시 설치해야 한다.
export const CORE_MIN_LAUNCHER = 1;

// 업데이트를 받아올 GitHub 저장소(owner/repo)
export const REPO = "Jaem-Shin/bid-radar";

// 서명 이름공간 — sign-release 스크립트의 -n 값과 같아야 한다
export const NAMESPACE = "bid-radar-release";

// 릴리스 서명 공개 키(ssh-ed25519 한 줄). 비어 있으면 자동 업데이트는 꺼진다.
// scripts/keygen.cmd 로 만든 release_key.pub 내용을 그대로 넣는다.
export const PUBKEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAXt+t8wGegT4l4/05vVBtdzMqp25HUU3pDQO69giW5R bid-radar-release";

// 확인 주기·첫 확인 지연
export const CHECK_INTERVAL_MS = 6 * 3600_000;
export const FIRST_CHECK_DELAY_MS = 15_000;

// 시작할 때 확인: 마지막 확인 후 이만큼 지났으면 시작 전에 확인하고, 제한 시간 안에 받으면 바로 적용한다.
// 시간 안에 못 받으면 내려받기는 계속되고 다음 시작 때 적용된다.
// 개발 중 즉시 반영은 수동 업데이트 도구(*_update)로 한다.
export const STARTUP_CHECK_MIN_GAP_MS = 6 * 3600_000;
export const STARTUP_CHECK_TIMEOUT_MS = 5_000;
