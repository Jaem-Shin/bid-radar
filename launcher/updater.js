// 자기 업데이트 — 서명 확인된 릴리스만 받아 두었다가 다음 시작 때 적용한다.
// 원칙: 서명·체크섬·시험 로드 중 하나라도 실패하면 받지 않는다. 실행 실패 시 내장본으로 돌아간다.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { verifySshSig } from "./sshsig.js";

export const FILES = { core: "core.mjs", release: "release.json", sig: "release.json.sig", pointer: "latest.json" };
const MAX_CORE_BYTES = 20 * 1024 * 1024;

// 릴리스 위치: 제품별 태그 <product>-v<버전>, 최신 버전 포인터는 <product>-channel 릴리스의 latest.json
export const tagOf = (product, version) => `${product}-v${version}`;
export const channelTag = (product) => `${product}-channel`;

export function cmpVersion(a, b) {
  const pa = String(a).split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * release.json·서명·core 바이트를 함께 검증. 통과하면 파싱된 release 객체.
 */
export function verifyRelease({ releaseText, sigText, coreBuf, pubkey, namespace, launcherVersion, name }) {
  verifySshSig(Buffer.from(releaseText), sigText, pubkey, namespace);
  let rel;
  try { rel = JSON.parse(releaseText); } catch { throw new Error("release.json 형식 오류"); }
  if (rel.name !== name) throw new Error(`다른 프로그램의 릴리스입니다(${rel.name})`);
  if (!/^\d+\.\d+\.\d+$/.test(rel.version || "")) throw new Error("릴리스 버전 형식 오류");
  if (!/^[0-9a-f]{64}$/.test(rel.sha256 || "")) throw new Error("릴리스 체크섬 형식 오류");
  if ((rel.minLauncher || 1) > launcherVersion) {
    const e = new Error(`이 업데이트는 새 설치 파일이 필요합니다(실행기 ${rel.minLauncher} 이상)`);
    e.needsReinstall = true;
    throw e;
  }
  if (coreBuf && sha256(coreBuf) !== rel.sha256) throw new Error("파일 체크섬이 서명된 값과 다릅니다");
  return rel;
}

async function readIfExists(p, enc) {
  try { return await fs.readFile(p, enc); } catch { return null; }
}

export async function readState(dataDir) {
  try { return JSON.parse(await fs.readFile(join(dataDir, "state.json"), "utf8")); } catch { return {}; }
}
export async function writeState(dataDir, state) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(join(dataDir, "state.json"), JSON.stringify(state, null, 2));
}

/**
 * 설치된 업데이트(current/)가 유효하면 {version, path}. 실행 때마다 다시 검증한다(디스크 변조 대비).
 */
export async function installedRelease({ dataDir, pubkey, namespace, launcherVersion, name }) {
  const dir = join(dataDir, "current");
  const [releaseText, sigText, coreBuf] = await Promise.all([
    readIfExists(join(dir, FILES.release), "utf8"),
    readIfExists(join(dir, FILES.sig), "utf8"),
    readIfExists(join(dir, FILES.core)),
  ]);
  if (!releaseText || !sigText || !coreBuf) return null;
  try {
    const rel = verifyRelease({ releaseText, sigText, coreBuf, pubkey, namespace, launcherVersion, name });
    return { version: rel.version, path: join(dir, FILES.core) };
  } catch (e) {
    return { invalid: e.message };
  }
}

async function fetchChecked(fetchImpl, url, { binary = false, timeoutMs = 30_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "bid-radar-updater" } });
    if (res.status === 404) { const e = new Error("없음(404)"); e.notFound = true; throw e; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_CORE_BYTES) throw new Error("파일이 너무 큽니다");
    return binary ? buf : buf.toString("utf8");
  } catch (e) {
    if (e.name === "AbortError") throw new Error("시간 초과");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/**
 * GitHub Releases의 최신 서명 릴리스를 확인해 더 새 버전이면 받아서 current/에 둔다(다음 시작 때 적용).
 * 반환: { status: "updated"|"latest"|"skipped"|"error", message, version? }
 */
export async function checkForUpdate({ repo, product, name, pubkey, namespace, launcherVersion, activeVersion, dataDir, fetchImpl = fetch, importImpl = (p) => import(p), baseUrl }) {
  const base = baseUrl || `https://github.com/${repo}/releases/download`;
  const state = await readState(dataDir);
  const bad = new Set(state.badVersions || []);
  let rel;
  try {
    // 1) 채널 포인터(서명 없음 — 버전 번호만 알려준다. 실제 신뢰는 2)의 서명으로 판단)
    let pointer;
    try {
      pointer = JSON.parse(await fetchChecked(fetchImpl, `${base}/${channelTag(product)}/${FILES.pointer}`));
    } catch (e) {
      if (e.notFound) return { status: "latest", message: "아직 배포된 업데이트가 없습니다" };
      throw new Error(`최신 버전 정보를 읽지 못했습니다: ${e.message}`);
    }
    const target = String(pointer?.version || "");
    if (!/^\d+\.\d+\.\d+$/.test(target)) throw new Error("최신 버전 정보 형식 오류");

    const installed = await installedRelease({ dataDir, pubkey, namespace, launcherVersion, name });
    const have = installed?.version && cmpVersion(installed.version, activeVersion) > 0 ? installed.version : activeVersion;
    if (cmpVersion(target, have) <= 0) return { status: "latest", message: `최신 버전입니다(${have})`, version: have };
    if (bad.has(target)) return { status: "skipped", message: `${target}은 이 PC에서 실행에 실패한 버전이라 건너뜁니다` };

    // 2) 해당 버전 릴리스의 서명된 release.json
    const relBase = `${base}/${tagOf(product, target)}`;
    const [releaseText, sigText] = await Promise.all([
      fetchChecked(fetchImpl, `${relBase}/${FILES.release}`),
      fetchChecked(fetchImpl, `${relBase}/${FILES.sig}`).catch((e) => {
        if (e.notFound) throw new Error(`${target} 릴리스에 서명이 아직 없습니다 — 서명 후 반영됩니다`);
        throw e;
      }),
    ]);
    rel = verifyRelease({ releaseText, sigText, coreBuf: null, pubkey, namespace, launcherVersion, name });
    if (rel.version !== target) throw new Error(`릴리스 버전(${rel.version})이 태그(${target})와 다릅니다`);

    const coreBuf = await fetchChecked(fetchImpl, `${relBase}/${FILES.core}`, { binary: true, timeoutMs: 60_000 });
    verifyRelease({ releaseText, sigText, coreBuf, pubkey, namespace, launcherVersion, name });

    // 임시 폴더에 쓰고 시험 로드(도구 목록이 나와야 함)
    const staging = join(dataDir, `staging-${rel.version}-${Date.now()}`);
    await fs.mkdir(staging, { recursive: true });
    await fs.writeFile(join(staging, FILES.core), coreBuf);
    await fs.writeFile(join(staging, FILES.release), releaseText);
    await fs.writeFile(join(staging, FILES.sig), sigText);
    try {
      const mod = await importImpl(pathToFileURL(join(staging, FILES.core)).href);
      if (mod.VERSION !== rel.version) throw new Error(`버전 표기 불일치(${mod.VERSION})`);
      const n = await mod.probe();
      if (!(n > 0)) throw new Error("도구 목록이 비어 있습니다");
    } catch (e) {
      await fs.rm(staging, { recursive: true, force: true });
      throw new Error(`시험 실행 실패: ${e.message}`);
    }

    // 교체: current → old, staging → current
    const current = join(dataDir, "current");
    const old = join(dataDir, "current.old");
    await fs.rm(old, { recursive: true, force: true });
    await fs.rename(current, old).catch(() => {});
    await fs.rename(staging, current);
    await fs.rm(old, { recursive: true, force: true });
    return { status: "updated", message: `${rel.version} 업데이트를 받았습니다 — Claude를 다시 시작하면 적용됩니다`, version: rel.version };
  } catch (e) {
    return { status: e.needsReinstall ? "skipped" : "error", message: e.message, version: rel?.version };
  }
}
