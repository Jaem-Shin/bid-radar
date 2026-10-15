import { z } from "zod";
import { call, Budget } from "../../common/client.js";
import { RAW_OPS } from "../services.js";
import { joinLines, sourceFooter } from "../../common/format.js";

const HIDE = new Set(["rptrKore", "bidwinnrCeoNm", "prcbdrCeoNm"]); // 업체 대표자명은 진단에서도 숨김

export default {
  name: "d2b_raw",
  title: "D2B 진단 조회",
  description:
    "개발자 진단용 — 사용자가 원 응답·필드 확인을 명시적으로 요청할 때만 쓴다. 일반 질문(공고·결과·계약 조회)에는 쓰지 말고 다른 d2b_ 도구를 쓴다. 방위사업청 API 오퍼레이션을 파라미터 그대로 호출해 원 응답 필드를 보여준다.",
  inputSchema: {
    service: z.enum(["plan", "bid", "result", "contract"]).describe("plan=조달계획, bid=입찰공고, result=입찰결과, contract=계약정보"),
    operation: z.string().describe("오퍼레이션명 (예: getFcltyCmpetBidPblancList)"),
    params: z.record(z.string(), z.string()).optional().describe("요청 파라미터 (serviceKey 제외)"),
    rows: z.coerce.number().int().min(1).max(20).optional().describe("보여줄 항목 수. 기본 3"),
  },
  async run(a) {
    if (!RAW_OPS[a.service].includes(a.operation)) {
      return `[ERROR] ${a.service} 서비스에 없는 오퍼레이션입니다. 가능: ${RAW_OPS[a.service].join(", ")}`;
    }
    const n = a.rows || 3;
    const r = await call(a.service, a.operation, { pageNo: 1, numOfRows: n, ...(a.params || {}) }, { budget: new Budget(2) });
    const items = r.items.slice(0, n).map((it) => Object.fromEntries(Object.entries(it).map(([k, v]) => [k, HIDE.has(k) ? "(숨김)" : v])));
    const fields = [...new Set(r.items.flatMap((it) => Object.keys(it)))];
    return joinLines([
      `[D2B 진단] ${a.service}/${a.operation}`,
      `요청: ${r.request}`,
      `totalCount ${r.total} · 받은 ${r.items.length}건`,
      `필드(${fields.length}): ${fields.join(", ")}`,
      "",
      "```json",
      JSON.stringify(items, null, 2),
      "```",
      sourceFooter([a.service]),
    ]);
  },
};
