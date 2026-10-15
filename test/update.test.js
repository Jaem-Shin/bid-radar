// 자기 업데이트·서명 검증 테스트 — 실제 ssh-keygen으로 서명한다(Windows 기본 ssh-keygen과 같은 형식).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, cpSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { verifySshSig } from "../launcher/sshsig.js";
import { checkForUpdate, installedRelease, verifyRelease, cmpVersion } from "../launcher/updater.js";

const NS = "bid-radar-release";
const REPO = "owner/bid-radar";
const PRODUCT = "g2b";
const NAME = "g2b-bid-radar";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hasSshKeygen = spawnSync("ssh-keygen", ["-?"]).error === undefined;
let work, keyA, pubA, keyB, pubB;

function keygen(name) {
  const k = join(work, name);
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", NS, "-f", k]);
  return [k, readFileSync(`${k}.pub`, "utf8").trim()];
}
function sign(key, file, ns = NS) {
  rmSync(`${file}.sig`, { force: true }); // ssh-keygen은 기존 .sig를 덮어쓰지 않는다
  execFileSync("ssh-keygen", ["-q", "-Y", "sign", "-f", key, "-n", ns, file], { stdio: "pipe" });
  return readFileSync(`${file}.sig`, "utf8");
}
const sha = (b) => createHash("sha256").update(b).digest("hex");

function fakeCore(version, { probeResult = 8, startThrows = false, marker = "", manualMarker = "" } = {}) {
  return Buffer.from(
    `export const VERSION = ${JSON.stringify(version)};\n` +
      `export async function probe() { ${probeResult === "throw" ? 'throw new Error("boom");' : `return ${probeResult};`} }\n` +
      `export async function start({ updateInfo } = {}) { ${startThrows ? 'throw new Error("start fail");' : ""} ` +
      (marker ? `(await import("node:fs")).writeFileSync(${JSON.stringify(marker)}, VERSION + "|" + (updateInfo?.activeSource||"") ); ` : "") +
      (manualMarker ? `{ const r = updateInfo?.checkNow ? await updateInfo.checkNow() : null; (await import("node:fs")).writeFileSync(${JSON.stringify(manualMarker)}, JSON.stringify(r)); } ` : "") +
      `}\n`,
  );
}

// 릴리스 한 벌(core·release.json·sig) 만들기
function makeRelease(version, { key = keyA, core = fakeCore(version), minLauncher = 1, name = NAME, ns = NS } = {}) {
  const d = mkdtempSync(join(work, `rel-${version}-`));
  const releaseText = JSON.stringify({ name, version, sha256: sha(core), minLauncher, commit: "" }, null, 2) + "\n";
  writeFileSync(join(d, "release.json"), releaseText);
  const sigText = sign(key, join(d, "release.json"), ns);
  return { core, releaseText, sigText };
}

// GitHub Releases 흉내: g2b-channel/latest.json → 버전, g2b-v{ver}/{release.json,.sig,core.mjs}
function fakeGitHub(rel, { noSig = false, coreOverride, pointer, noPointer = false } = {}) {
  const calls = [];
  const ver = JSON.parse(rel.releaseText).version;
  const f = async (url) => {
    calls.push(url);
    const base = `https://github.com/${REPO}/releases/download`;
    let body = null;
    if (url === `${base}/${PRODUCT}-channel/latest.json`) body = noPointer ? null : JSON.stringify({ version: pointer ?? ver });
    else if (url === `${base}/${PRODUCT}-v${ver}/release.json`) body = rel.releaseText;
    else if (url === `${base}/${PRODUCT}-v${ver}/release.json.sig`) body = noSig ? null : rel.sigText;
    else if (url === `${base}/${PRODUCT}-v${ver}/core.mjs`) body = coreOverride ?? rel.core;
    if (body === null) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    const b = Buffer.from(body);
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
  };
  f.calls = calls;
  return f;
}

const opts = (dataDir, fetchImpl, extra = {}) => ({ repo: REPO, product: PRODUCT, name: NAME, pubkey: pubA, namespace: NS, launcherVersion: 1, activeVersion: "0.0.1", dataDir, fetchImpl, ...extra });

before(() => {
  work = mkdtempSync(join(tmpdir(), "nara-upd-"));
  if (hasSshKeygen) {
    [keyA, pubA] = keygen("a");
    [keyB, pubB] = keygen("b");
  }
});

test("버전 비교", () => {
  assert.ok(cmpVersion("0.0.10", "0.0.9") > 0);
  assert.ok(cmpVersion("0.1.0", "0.0.99") > 0);
  assert.equal(cmpVersion("1.2.3", "1.2.3"), 0);
});

test("SSH 서명 검증: 정상·변조·다른 키·다른 이름공간", { skip: !hasSshKeygen && "ssh-keygen 없음" }, () => {
  const f = join(work, "msg.txt");
  writeFileSync(f, "hello");
  const sig = sign(keyA, f);
  assert.equal(verifySshSig(Buffer.from("hello"), sig, pubA, NS), true);
  assert.throws(() => verifySshSig(Buffer.from("hellO"), sig, pubA, NS), /서명이 맞지 않습니다/);
  assert.throws(() => verifySshSig(Buffer.from("hello"), sig, pubB, NS), /신뢰하지 않는 키/);
  assert.throws(() => verifySshSig(Buffer.from("hello"), sig, pubA, "other"), /이름공간 불일치/);
  const sigOtherNs = sign(keyA, f, "other");
  assert.throws(() => verifySshSig(Buffer.from("hello"), sigOtherNs, pubA, NS), /이름공간 불일치/);
  assert.throws(() => verifySshSig(Buffer.from("hello"), "garbage", pubA, NS), /SSH 서명 블록이 없습니다/);
});

test("업데이트: 서명된 새 버전을 받아 시험 로드 후 설치", { skip: !hasSshKeygen && "ssh-keygen 없음" }, async () => {
  const dataDir = mkdtempSync(join(work, "data-"));
  const rel = makeRelease("0.0.2");
  const r = await checkForUpdate(opts(dataDir, fakeGitHub(rel)));
  assert.equal(r.status, "updated", r.message);
  assert.equal(r.version, "0.0.2");
  const inst = await installedRelease({ dataDir, pubkey: pubA, namespace: NS, launcherVersion: 1, name: NAME });
  assert.equal(inst.version, "0.0.2");
  // 다시 확인하면 최신
  const r2 = await checkForUpdate(opts(dataDir, fakeGitHub(rel)));
  assert.equal(r2.status, "latest");
});

test("거부: 서명 없음 / 다른 키 / 체크섬 변조 / 다운그레이드 / 새 실행기 필요 / 시험 실행 실패", { skip: !hasSshKeygen && "ssh-keygen 없음" }, async () => {
  const cases = [
    ["서명 없음", makeRelease("0.0.2"), { noSig: true }, {}, /서명이 아직 없습니다/, "error"],
    ["다른 키", makeRelease("0.0.2", { key: keyB }), {}, {}, /신뢰하지 않는 키/, "error"],
    ["체크섬 변조", makeRelease("0.0.2"), { coreOverride: fakeCore("0.0.2", { probeResult: 99 }) }, {}, /체크섬이 서명된 값과 다릅니다/, "error"],
    ["다운그레이드", makeRelease("0.0.1"), {}, {}, /최신 버전입니다/, "latest"],
    ["새 실행기 필요", makeRelease("0.0.2", { minLauncher: 2 }), {}, {}, /새 설치 파일이 필요합니다/, "skipped"],
    ["다른 프로그램", makeRelease("0.0.2", { name: "evil" }), {}, {}, /다른 프로그램의 릴리스/, "error"],
    ["시험 실행 실패", makeRelease("0.0.2", { core: fakeCore("0.0.2", { probeResult: "throw" }) }), {}, {}, /시험 실행 실패/, "error"],
    ["도구 0개", makeRelease("0.0.2", { core: fakeCore("0.0.2", { probeResult: 0 }) }), {}, {}, /도구 목록이 비어/, "error"],
    ["버전 표기 불일치", makeRelease("0.0.2", { core: fakeCore("0.0.3") }), {}, {}, /버전 표기 불일치/, "error"],
    ["배포 없음", makeRelease("0.0.2"), { noPointer: true }, {}, /아직 배포된 업데이트가 없습니다/, "latest"],
    ["포인터만 높음(서명 릴리스 없음)", makeRelease("0.0.2"), { pointer: "0.0.9" }, {}, /없음\(404\)|서명이 아직 없습니다/, "error"],
  ];
  for (const [label, rel, gh, extra, re, status] of cases) {
    const dataDir = mkdtempSync(join(work, "data-"));
    const r = await checkForUpdate(opts(dataDir, fakeGitHub(rel, gh), extra));
    assert.equal(r.status, status, `${label}: ${r.message}`);
    assert.match(r.message, re, label);
    assert.equal(existsSync(join(dataDir, "current")), false, `${label}: 설치되면 안 됨`);
  }
});

test("설치 후 디스크에서 변조되면 사용하지 않음", { skip: !hasSshKeygen && "ssh-keygen 없음" }, async () => {
  const dataDir = mkdtempSync(join(work, "data-"));
  await checkForUpdate(opts(dataDir, fakeGitHub(makeRelease("0.0.2"))));
  writeFileSync(join(dataDir, "current", "core.mjs"), "export const VERSION='0.0.2'; /* tampered */");
  const inst = await installedRelease({ dataDir, pubkey: pubA, namespace: NS, launcherVersion: 1, name: NAME });
  assert.match(inst.invalid, /체크섬/);
});

test("verifyRelease는 서명 없는 release.json을 거부", { skip: !hasSshKeygen && "ssh-keygen 없음" }, () => {
  const rel = makeRelease("0.0.2");
  const forged = rel.releaseText.replace("0.0.2", "9.9.9");
  assert.throws(() => verifyRelease({ releaseText: forged, sigText: rel.sigText, coreBuf: null, pubkey: pubA, namespace: NS, launcherVersion: 1, name: NAME }), /서명이 맞지 않습니다/);
});

// 실행기 전체: 설치된 업데이트 선택 / 실행 실패 시 내장본 복귀
function prepareLauncher(pub) {
  const d = mkdtempSync(join(work, "launcher-"));
  cpSync(join(root, "launcher"), d, { recursive: true });
  const cfg = readFileSync(join(d, "config.js"), "utf8")
    .replace(/export const PUBKEY = ".*";/, `export const PUBKEY = ${JSON.stringify(pub)};`)
    .replace(/export const REPO = ".*";/, `export const REPO = "${REPO}";`);
  writeFileSync(join(d, "config.js"), cfg);
  return d;
}
async function installSigned(dataDir, rel) {
  const r = await checkForUpdate(opts(dataDir, fakeGitHub(rel)));
  assert.equal(r.status, "updated", r.message);
}
function runLauncher(dir, dataRoot) {
  return spawnSync(process.execPath, [join(dir, "index.js")], { env: { ...process.env, LOCALAPPDATA: dataRoot, AUTO_UPDATE: "false", BR_TEST_PRODUCT: PRODUCT }, encoding: "utf8", timeout: 20_000 });
}

test("실행기: 검증된 업데이트본을 실행하고, 실행 실패하면 내장본으로 복귀", { skip: !hasSshKeygen && "ssh-keygen 없음" }, async () => {
  // 정상 업데이트본
  let dir = prepareLauncher(pubA);
  let dataRoot = mkdtempSync(join(work, "appdata-"));
  let marker = join(work, `m-${Date.now()}`);
  writeFileSync(join(dir, "core.mjs"), fakeCore("0.0.1", { marker: marker + ".bundled" }));
  mkdirSync(join(dataRoot, "bid-radar", PRODUCT), { recursive: true });
  await installSigned(join(dataRoot, "bid-radar", PRODUCT), makeRelease("0.0.2", { core: fakeCore("0.0.2", { marker }) }));
  let r = runLauncher(dir, dataRoot);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(marker, "utf8"), "0.0.2|bundled", "업데이트본 실행(activeSource는 start 이후 갱신)");
  assert.match(r.stderr, /서버 0\.0\.2 \(업데이트본\)/);

  // 업데이트본 start 실패 → 내장본
  dir = prepareLauncher(pubA);
  dataRoot = mkdtempSync(join(work, "appdata-"));
  marker = join(work, `m2-${Date.now()}`);
  writeFileSync(join(dir, "core.mjs"), fakeCore("0.0.1", { marker }));
  mkdirSync(join(dataRoot, "bid-radar", PRODUCT), { recursive: true });
  // 시험 로드는 통과(probe ok)하지만 start에서 실패하는 버전
  await installSigned(join(dataRoot, "bid-radar", PRODUCT), makeRelease("0.0.3", { core: fakeCore("0.0.3", { startThrows: true }) }));
  r = runLauncher(dir, dataRoot);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(marker, "utf8").split("|")[0], "0.0.1");
  assert.match(r.stderr, /0\.0\.3 실행 실패, 내장본으로 실행합니다/);
  const state = JSON.parse(readFileSync(join(dataRoot, "bid-radar", PRODUCT, "state.json"), "utf8"));
  assert.deepEqual(state.badVersions, ["0.0.3"]);

  // 서명 키 미설정이면 업데이트본을 쓰지 않음
  dir = prepareLauncher("");
  marker = join(work, `m3-${Date.now()}`);
  writeFileSync(join(dir, "core.mjs"), fakeCore("0.0.1", { marker }));
  r = runLauncher(dir, dataRoot);
  assert.equal(readFileSync(marker, "utf8").split("|")[0], "0.0.1");
});

// 시작할 때 확인: 로컬 HTTP 서버를 GitHub Releases 대신 쓴다
function releaseServer(rel, { delayMs = 0 } = {}) {
  const ver = JSON.parse(rel.releaseText).version;
  const files = {
    [`/${PRODUCT}-channel/latest.json`]: JSON.stringify({ version: ver }),
    [`/${PRODUCT}-v${ver}/release.json`]: rel.releaseText,
    [`/${PRODUCT}-v${ver}/release.json.sig`]: rel.sigText,
    [`/${PRODUCT}-v${ver}/core.mjs`]: rel.core,
  };
  const srv = createServer((req, res) => {
    setTimeout(() => {
      const body = files[req.url];
      if (body === undefined) { res.writeHead(404); return res.end(); }
      res.writeHead(200);
      res.end(body);
    }, delayMs);
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` })));
}
function runLauncherAsync(dir, dataRoot, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(dir, "index.js")], { env: { ...process.env, LOCALAPPDATA: dataRoot, AUTO_UPDATE: "true", BR_TEST_PRODUCT: PRODUCT, BR_TEST_VERSION: "0.0.1", ...env } });
    let stderr = "";
    p.stderr.on("data", (d) => { stderr += d; if (process.env.DBG) process.stderr.write("[child] " + d); });
    p.stdin.end();
    const t = setTimeout(() => p.kill(), 20_000);
    p.on("close", (status) => { clearTimeout(t); resolve({ status, stderr }); });
  });
}

test("실행기 2: 시작할 때 새 버전을 받아 바로 적용, 늦으면 다음 시작 때 적용", { skip: !hasSshKeygen && "ssh-keygen 없음" }, async () => {
  // 빠른 응답 → 이번 시작부터 0.0.2
  let dir = prepareLauncher(pubA);
  let dataRoot = mkdtempSync(join(work, "appdata-"));
  let marker = join(work, `s1-${Date.now()}`);
  writeFileSync(join(dir, "core.mjs"), fakeCore("0.0.1", { marker }));
  const servers = [];
  try {
    let { srv, base } = await releaseServer(makeRelease("0.0.2", { core: fakeCore("0.0.2", { marker }) }));
    servers.push(srv);
    let r = await runLauncherAsync(dir, dataRoot, { BR_TEST_RELEASE_BASE: base });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(marker, "utf8").split("|")[0], "0.0.2", r.stderr);
    assert.match(r.stderr, /서버 0\.0\.2 \(업데이트본\)/);
    const st = JSON.parse(readFileSync(join(dataRoot, "bid-radar", PRODUCT, "state.json"), "utf8"));
    assert.match(st.lastResult, /0\.0\.2 업데이트를 받아 적용했습니다/);

    // 느린 응답(제한 시간 초과) → 이번엔 내장본, 내려받기는 마저 끝나고 다음 시작 때 0.0.2
    dir = prepareLauncher(pubA);
    dataRoot = mkdtempSync(join(work, "appdata-"));
    marker = join(work, `s2-${Date.now()}`);
    writeFileSync(join(dir, "core.mjs"), fakeCore("0.0.1", { marker }));
    ({ srv, base } = await releaseServer(makeRelease("0.0.2", { core: fakeCore("0.0.2", { marker }) }), { delayMs: 400 }));
    servers.push(srv);
    r = await runLauncherAsync(dir, dataRoot, { BR_TEST_RELEASE_BASE: base, BR_TEST_STARTUP_TIMEOUT_MS: "200" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /서버 0\.0\.1 \(내장본\)/);
    assert.match(r.stderr, /업데이트 확인: .*0\.0\.2/);
    r = await runLauncherAsync(dir, dataRoot, { BR_TEST_RELEASE_BASE: base, BR_TEST_STARTUP_TIMEOUT_MS: "200" });
    assert.match(r.stderr, /서버 0\.0\.2 \(업데이트본\)/, "두 번째 시작에서 적용");
    assert.doesNotMatch(r.stderr, /업데이트 확인:/, "30분 안에는 다시 확인하지 않음");
  } finally {
    for (const s of servers) { s.closeAllConnections?.(); s.close(); }
  }
});

test("실행기 3: 수동 확인(checkNow)은 간격과 상관없이 받고, 다음 시작 때 적용", { skip: !hasSshKeygen && "ssh-keygen 없음" }, async () => {
  const dir = prepareLauncher(pubA);
  const dataRoot = mkdtempSync(join(work, "appdata-"));
  const dataDir = join(dataRoot, "bid-radar", PRODUCT);
  mkdirSync(dataDir, { recursive: true });
  // 방금 확인한 상태 → 시작 시 자동 확인은 건너뜀
  writeFileSync(join(dataDir, "state.json"), JSON.stringify({ lastCheck: new Date().toISOString(), lastResult: "최신" }));
  const marker = join(work, `mm-${Date.now()}`);
  const manual = join(work, `mn-${Date.now()}`);
  writeFileSync(join(dir, "core.mjs"), fakeCore("0.0.1", { marker, manualMarker: manual }));
  const { srv, base } = await releaseServer(makeRelease("0.0.2", { core: fakeCore("0.0.2", { marker }) }));
  try {
    let r = await runLauncherAsync(dir, dataRoot, { BR_TEST_RELEASE_BASE: base });
    assert.match(r.stderr, /서버 0\.0\.1 \(내장본\)/, "자동 확인은 건너뜀");
    const res = JSON.parse(readFileSync(manual, "utf8"));
    assert.equal(res.status, "updated", JSON.stringify(res));
    r = await runLauncherAsync(dir, dataRoot, { BR_TEST_RELEASE_BASE: base });
    assert.match(r.stderr, /서버 0\.0\.2 \(업데이트본\)/, "다음 시작 때 적용");
  } finally {
    srv.closeAllConnections?.(); srv.close();
  }
});
