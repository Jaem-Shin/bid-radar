// 관심 키워드 도구(제품 공통) — 키워드만 저장, 기관은 전체 대상.
import { z } from "zod";
import { joinLines } from "./format.js";
import { readWatch, writeWatch, cleanKeyword, MAX_KEYWORDS, watchFile } from "./watch.js";

export function makeKeywordsTool(prefix) {
  return {
    name: `${prefix}_keywords`,
    title: "관심 키워드",
    readOnly: false,
    description:
      "신규 공고 브리핑·마감 일정판에 쓰는 관심 키워드를 보거나 추가·삭제한다(공고명에 포함된 단어로 찾음, 기관은 전체 대상). " +
      "G2B·D2B가 같은 키워드를 쓴다. 예: 설계사무소 '설계', 건설사업관리(CM)사 '건설사업관리'·'감리'. 인자 없이 부르면 현재 목록을 보여준다.",
    inputSchema: {
      add: z.array(z.string()).optional().describe("추가할 키워드"),
      remove: z.array(z.string()).optional().describe("삭제할 키워드"),
      clear: z.boolean().optional().describe("true면 모두 삭제"),
    },
    async run(a) {
      const w = await readWatch();
      const before = [...w.keywords];
      let list = a.clear ? [] : [...w.keywords];
      const rm = new Set((a.remove || []).map(cleanKeyword));
      list = list.filter((k) => !rm.has(k));
      const notes = [];
      for (const k of (a.add || []).map(cleanKeyword).filter(Boolean)) {
        if (list.includes(k)) continue;
        if (list.length >= MAX_KEYWORDS) { notes.push(`키워드는 최대 ${MAX_KEYWORDS}개라 '${k}'는 추가하지 않았습니다.`); continue; }
        list.push(k);
      }
      const changed = JSON.stringify(list) !== JSON.stringify(before);
      if (changed) await writeWatch({ ...w, keywords: list });
      return joinLines([
        `[관심 키워드] ${list.length ? list.join(", ") : "(없음)"}`,
        changed ? `변경: ${before.join(", ") || "(없음)"} → ${list.join(", ") || "(없음)"}` : null,
        ...notes,
        list.length ? "브리핑·마감 일정판이 이 키워드로 공고명을 찾습니다(G2B·D2B 공통, 전 기관)." : "키워드를 추가하세요. 예: '설계' 또는 '건설사업관리', '감리'.",
        `저장 위치: ${watchFile()}`,
      ]);
    },
  };
}
