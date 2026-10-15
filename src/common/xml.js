// 작은 XML → 객체 변환기 — data.go.kr 응답(response/header/body/items/item) 수준만 다룬다.
// 규칙: 자식 없는 요소는 문자열, 같은 이름 형제가 여럿이면 배열, 속성은 무시.

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENT[e];
  });
}

export function parseXml(text) {
  const src = String(text).replace(/^﻿/, "");
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)([^>]*?)(\/?)>|([^<]+)/g;
  const root = { name: "#root", children: [], text: "" };
  const stack = [root];
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      // 닫는 태그: 이름이 맞는 데까지 올라간다(잘못된 중첩에 관대)
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === m[2]) { stack.length = i; break; }
      }
    } else if (m[3] !== undefined) {
      const node = { name: m[3], children: [], text: "" };
      top.children.push(node);
      if (m[5] !== "/") stack.push(node);
    } else if (m[6] !== undefined) top.text += decode(m[6]);
  }
  return toObj(root);
}

function toObj(node) {
  if (!node.children.length) return node.text.trim();
  const out = {};
  for (const c of node.children) {
    const v = toObj(c);
    if (c.name in out) {
      if (!Array.isArray(out[c.name]) || !out[c.name].__multi) {
        out[c.name] = Object.assign([out[c.name]], { __multi: true });
      }
      out[c.name].push(v);
    } else out[c.name] = v;
  }
  for (const k of Object.keys(out)) if (Array.isArray(out[k])) out[k] = [...out[k]];
  return out;
}
