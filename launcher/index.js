// 실행기 — Claude Desktop이 실행하는 진입점(.mcpb의 server/index.mjs). 제품(g2b/d2b)별로 빌드된다.
// 1) 설치된 업데이트가 서명·체크섬 검증되고 내장본보다 새로우면 그것을, 아니면 내장본(core.mjs)을 실행
// 2) 시작할 때(마지막 확인 6시간 경과 시) 먼저 확인 — 5초 안에 받으면 이번 실행부터 새 버전
// 2-1) 수동 확인: 서버의 *_update 도구가 info.checkNow()를 부른다(간격 무시, 받은 버전은 다음 시작 때 적용)
// 3) 실행 중에도 6시간마다 확인 → 그때 받은 업데이트는 다음 시작 때 적용
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LAUNCHER_VERSION, REPO, NAMESPACE, PUBKEY, CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, STARTUP_CHECK_MIN_GAP_MS, STARTUP_CHECK_TIMEOUT_MS } from "./config.js";
import { installedRelease, checkForUpdate, readState, writeState, cmpVersion } from "./updater.js";

/* global __BUNDLED_VERSION__, __PRODUCT__, __PRODUCT_NAME__ */
// 빌드 시 제품별로 채워진다(scripts/build.mjs). 테스트에서는 환경변수로 대신한다.
const BUNDLED_VERSION = typeof __BUNDLED_VERSION__ === "string" ? __BUNDLED_VERSION__ : process.env.BR_TEST_VERSION || "0.0.0";
const PRODUCT = typeof __PRODUCT__ === "string" ? __PRODUCT__ : process.env.BR_TEST_PRODUCT || "g2b";
const NAME = typeof __PRODUCT_NAME__ === "string" ? __PRODUCT_NAME__ : `${PRODUCT}-bid-radar`;
const log = (...a) => console.error(`[${NAME}]`, ...a); // stdout은 JSON-RPC 전용

function dataDir() {
  const base = process.env.LOCALAPPDATA || join(homedir(), ".local", "share");
  return join(base, "bid-radar", PRODUCT);
}

function autoUpdateEnabled() {
  const v = String(process.env.AUTO_UPDATE ?? "true").trim().toLowerCase();
  return !["false", "0", "no", "off"].includes(v);
}

const here = dirname(fileURLToPath(import.meta.url));
const dir = dataDir();
const keyConfigured = PUBKEY.trim().startsWith("ssh-ed25519 ");
const state = await readState(dir);

const info = {
  launcherVersion: LAUNCHER_VERSION,
  bundledVersion: BUNDLED_VERSION,
  activeVersion: BUNDLED_VERSION,
  activeSource: "bundled",
  autoUpdate: autoUpdateEnabled() && keyConfigured,
  autoUpdateNote: !keyConfigured ? "서명 키 미설정" : autoUpdateEnabled() ? "" : "설정에서 끔",
  repo: REPO,
  product: PRODUCT,
  lastCheck: state.lastCheck || null,
  lastResult: state.lastResult || null,
  pendingVersion: null,
};

// 업데이트 확인(동시에 한 번만). minGapMs 안에 확인한 적이 있으면 건너뜀.
let inflight = null;
function checkNow(minGapMs, { manual = false } = {}) {
  if (!keyConfigured) return Promise.resolve(manual ? { status: "error", message: "서명 키가 설정되지 않은 설치본이라 업데이트를 받을 수 없습니다" } : null);
  if (!manual && !info.autoUpdate) return Promise.resolve(null);
  if (inflight) return inflight;
  inflight = (async () => {
    const s = await readState(dir);
    if (!manual && s.lastCheck && Date.now() - Date.parse(s.lastCheck) < minGapMs) return null;
    const r = await checkForUpdate({
      repo: REPO, product: PRODUCT, name: NAME, pubkey: PUBKEY, namespace: NAMESPACE, launcherVersion: LAUNCHER_VERSION,
      activeVersion: info.activeVersion, dataDir: dir, baseUrl: process.env.BR_TEST_RELEASE_BASE || undefined,
    });
    const now = new Date().toISOString();
    info.lastCheck = now;
    info.lastResult = r.message;
    if (r.status === "updated" && cmpVersion(r.version, info.activeVersion) > 0) info.pendingVersion = r.version;
    await writeState(dir, { ...(await readState(dir)), lastCheck: now, lastResult: r.message }).catch(() => {});
    log("업데이트 확인:", r.message);
    return r;
  })().catch((e) => { log("업데이트 확인 오류:", e?.message || e); return null; }).finally(() => { inflight = null; });
  return inflight;
}

// 서버(코어)의 수동 업데이트 도구용 — 자동 업데이트를 꺼 둬도 사용자가 요청하면 확인한다
info.checkNow = () => checkNow(0, { manual: true });

// 시작 전 확인 — 제한 시간을 넘기면 기다리지 않고 지금 있는 버전으로 시작(내려받기는 계속)
if (info.autoUpdate) {
  const timeout = Number(process.env.BR_TEST_STARTUP_TIMEOUT_MS) || STARTUP_CHECK_TIMEOUT_MS;
  let timer;
  await Promise.race([checkNow(STARTUP_CHECK_MIN_GAP_MS), new Promise((r) => { timer = setTimeout(r, timeout); })]);
  clearTimeout(timer);
}

async function run(path) {
  const mod = await import(pathToFileURL(path).href);
  await mod.start({ updateInfo: info });
  return mod;
}

let started = false;
if (keyConfigured) {
  const inst = await installedRelease({ dataDir: dir, pubkey: PUBKEY, namespace: NAMESPACE, launcherVersion: LAUNCHER_VERSION, name: NAME });
  if (inst?.invalid) log("설치된 업데이트가 검증에 실패해 사용하지 않습니다:", inst.invalid);
  const bad = new Set(state.badVersions || []);
  if (inst?.version && cmpVersion(inst.version, BUNDLED_VERSION) > 0 && !bad.has(inst.version)) {
    try {
      await run(inst.path);
      info.activeVersion = inst.version;
      info.activeSource = "updated";
      started = true;
    } catch (e) {
      log(`업데이트 ${inst.version} 실행 실패, 내장본으로 실행합니다:`, e?.message || e);
      await writeState(dir, { ...state, badVersions: [...bad, inst.version] }).catch(() => {});
    }
  }
}
if (!started) await run(join(here, "core.mjs"));
// 시작 전에 받아 바로 적용된 경우 안내 문구 정정
if (info.pendingVersion && cmpVersion(info.pendingVersion, info.activeVersion) <= 0) {
  info.pendingVersion = null;
  info.lastResult = `${info.activeVersion} 업데이트를 받아 적용했습니다`;
  await writeState(dir, { ...(await readState(dir)), lastResult: info.lastResult }).catch(() => {});
}
log(`실행기 ${LAUNCHER_VERSION} · 서버 ${info.activeVersion} (${info.activeSource === "updated" ? "업데이트본" : "내장본"})`);

// 실행 중 확인(6시간 주기). 받은 업데이트는 다음 시작 때 적용.
setTimeout(() => { checkNow(CHECK_INTERVAL_MS); }, FIRST_CHECK_DELAY_MS).unref();
setInterval(() => { checkNow(CHECK_INTERVAL_MS); }, CHECK_INTERVAL_MS).unref();
