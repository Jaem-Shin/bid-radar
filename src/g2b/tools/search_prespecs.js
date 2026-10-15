import { z } from "zod";
import { Budget } from "../../common/client.js";
import { KINDS, resolveKinds } from "../services.js";
import { resolveRange } from "../../common/dates.js";
import { fanSearch, summaryHeader } from "../../common/search.js";
import { val, won, when, has, joinLines, sourceFooter, NOT_FOUND } from "../../common/format.js";
import { KIND_ENUM } from "./search_bids.js";

// 응답 안의 첨부(…FileNm{n} / …FileUrl{n} 또는 …DocUrl{n}) 쌍을 이름 규칙으로 찾는다 — 필드명 미확정 대비
function attachments(it) {
  const out = [];
  for (const [k, v] of Object.entries(it)) {
    const m = k.match(/^(.*?)(?:Url|URL)(\d+)$/);
    if (!m || !has(v)) continue;
    const base = m[1].replace(/(Doc|File)$/, "");
    const nameKey = Object.keys(it).find((x) => x.startsWith(base) && /Nm\d+$/.test(x) && x.endsWith(m[2]));
    out.push({ name: nameKey ? val(it[nameKey]) : `${m[2]}`, url: val(v).replace(/\s+/g, "") });
  }
  return out;
}

export default {
  name: "g2b_search_prespecs",
  title: "사전규격 검색",
  description:
    "입찰공고 전에 공개되는 사전규격을 검색한다(나라장터 검색조건 오퍼레이션). 사업명·기관명 일부로 거를 수 있다. 기본 최근 30일(등록일 기준), 최대 12개월. " +
    "의견등록 마감일과, 이미 공고가 났으면 연결된 입찰공고번호를 보여준다.",
  inputSchema: {
    keyword: z.string().optional().describe("품명(사업명) 일부"),
    institution: z.string().optional().describe("공고(발주)기관명 일부"),
    demand_institution: z.string().optional().describe("수요기관명 일부"),
    kind: KIND_ENUM.optional().describe("업무구분. 기본 용역"),
    from: z.string().optional().describe("시작일 YYYY-MM-DD"),
    to: z.string().optional().describe("종료일 YYYY-MM-DD (기본 오늘)"),
    limit: z.coerce.number().int().min(1).max(200).optional().describe("표시 최대 건수. 기본 30"),
  },
  async run(a) {
    const kinds = resolveKinds(a.kind || "용역");
    const { start, end, windows } = resolveRange(a.from, a.to, { defaultDays: 30, maxMonths: 12 });
    const limit = a.limit || 30;
    const budget = new Budget(60);
    const r = await fanSearch({
      service: "prespec",
      opFor: (k) => `getPublicPrcureThngInfo${KINDS[k].suffix}PPSSrch`,
      params: {
        inqryDiv: 1,
        prdctClsfcNoNm: a.keyword,
        ntceInsttNm: a.institution,
        dminsttNm: a.demand_institution,
      },
      kinds,
      windows,
      limit,
      budget,
    });
    const header = summaryHeader({ title: "사전규격 검색", start, end, basis: "등록일", total: r.total, shown: r.rows.length, perKind: r.perKind, errors: r.errors });
    if (!r.rows.length) {
      return joinLines([header, "", `${NOT_FOUND} 조건에 맞는 사전규격이 API에 없습니다.`, sourceFooter(["prespec"])]);
    }
    const rows = r.rows.sort((x, y) => val(y.item.rgstDt).localeCompare(val(x.item.rgstDt)));
    const body = rows.map(({ kind, item: it }) => {
      const files = attachments(it);
      const linked = val(it.bidNtceNoList);
      return joinLines([
        `■ [${kind}] ${val(it.prdctClsfcNoNm) || val(it.bfSpecRgstNm) || "(사업명 없음)"}`,
        `  사전규격등록번호 ${val(it.bfSpecRgstNo) || "-"}${has(it.refNo) ? ` · 참조번호 ${val(it.refNo)}` : ""}`,
        `  기관: ${[val(it.orderInsttNm) || val(it.ntceInsttNm), has(it.rlDminsttNm) ? `수요 ${val(it.rlDminsttNm)}` : ""].filter(Boolean).join(" / ") || "-"}`,
        has(it.asignBdgtAmt) ? `  배정예산 ${won(it.asignBdgtAmt)}` : null,
        `  등록 ${val(it.rgstDt) || "-"} · 의견등록 마감 ${when(it.opninRgstClseDt) || "-"}`,
        linked ? `  연결된 입찰공고: ${linked}` : "  연결된 입찰공고: 아직 없음(API 기준)",
        ...files.slice(0, 5).map((f) => `  첨부 ${f.name}\n    ${f.url}`),
      ]);
    });
    return joinLines([
      header,
      "",
      body.join("\n\n"),
      sourceFooter(["prespec"], ["※ 사전규격은 공고 전 단계라 실제 공고 내용과 달라질 수 있습니다."]),
    ]);
  },
};
