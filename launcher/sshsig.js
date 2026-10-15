// OpenSSH 서명(ssh-keygen -Y sign) 검증 — ssh-ed25519 전용, Node 내장 crypto만 사용.
// 형식: https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.sshsig
import { createHash, createPublicKey, verify } from "node:crypto";

const MAGIC = Buffer.from("SSHSIG");

class Reader {
  constructor(buf) { this.b = buf; this.o = 0; }
  u32() {
    if (this.o + 4 > this.b.length) throw new Error("서명 형식 오류(길이)");
    const v = this.b.readUInt32BE(this.o); this.o += 4; return v;
  }
  str() {
    const n = this.u32();
    if (n > this.b.length - this.o) throw new Error("서명 형식 오류(필드)");
    const v = this.b.subarray(this.o, this.o + n); this.o += n; return v;
  }
  done() { return this.o === this.b.length; }
}

function sshString(buf) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length);
  return Buffer.concat([len, buf]);
}

// "ssh-ed25519 AAAA... comment" → 32바이트 공개 키
export function parsePublicKeyLine(line) {
  const parts = String(line || "").trim().split(/\s+/);
  if (parts[0] !== "ssh-ed25519" || !parts[1]) throw new Error("공개 키는 ssh-ed25519 한 줄이어야 합니다");
  return parseKeyBlob(Buffer.from(parts[1], "base64"));
}

function parseKeyBlob(blob) {
  const r = new Reader(blob);
  const type = r.str().toString();
  const key = r.str();
  if (type !== "ssh-ed25519" || key.length !== 32 || !r.done()) throw new Error("ssh-ed25519 공개 키가 아닙니다");
  return key;
}

function armorToBlob(text) {
  const m = String(text).match(/-----BEGIN SSH SIGNATURE-----([\s\S]*?)-----END SSH SIGNATURE-----/);
  if (!m) throw new Error("SSH 서명 블록이 없습니다");
  return Buffer.from(m[1].replace(/\s+/g, ""), "base64");
}

/**
 * @param message Buffer|string — 서명된 원문 바이트
 * @param sigText ssh-keygen -Y sign 출력(.sig 파일 내용)
 * @param pubkeyLine 신뢰하는 공개 키 한 줄
 * @param namespace 기대 이름공간
 * 성공 시 true, 실패 시 사유와 함께 throw
 */
export function verifySshSig(message, sigText, pubkeyLine, namespace) {
  const trusted = parsePublicKeyLine(pubkeyLine);
  const r = new Reader(armorToBlob(sigText));
  const magic = r.b.subarray(0, 6); r.o = 6;
  if (!magic.equals(MAGIC)) throw new Error("SSHSIG 서명이 아닙니다");
  if (r.u32() !== 1) throw new Error("지원하지 않는 서명 버전");
  const keyBlob = r.str();
  const ns = r.str();
  const reserved = r.str();
  const hashAlg = r.str().toString();
  const sigBlob = r.str();
  if (!r.done()) throw new Error("서명 뒤에 남는 데이터가 있습니다");

  if (!parseKeyBlob(keyBlob).equals(trusted)) throw new Error("신뢰하지 않는 키로 서명됐습니다");
  if (ns.toString() !== namespace) throw new Error(`서명 이름공간 불일치(${ns})`);
  if (hashAlg !== "sha512" && hashAlg !== "sha256") throw new Error(`지원하지 않는 해시(${hashAlg})`);

  const sr = new Reader(sigBlob);
  const sigType = sr.str().toString();
  const sig = sr.str();
  if (sigType !== "ssh-ed25519" || sig.length !== 64 || !sr.done()) throw new Error("ssh-ed25519 서명이 아닙니다");

  const digest = createHash(hashAlg).update(typeof message === "string" ? Buffer.from(message) : message).digest();
  const signed = Buffer.concat([MAGIC, sshString(ns), sshString(reserved), sshString(Buffer.from(hashAlg)), sshString(digest)]);
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: trusted.toString("base64url") }, format: "jwk" });
  if (!verify(null, signed, key, sig)) throw new Error("서명이 맞지 않습니다(변조 또는 다른 파일)");
  return true;
}
