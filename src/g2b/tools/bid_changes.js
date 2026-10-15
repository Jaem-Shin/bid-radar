import { z } from "zod";
import { Budget, callAll } from "../../common/client.js";
import { KINDS } from "../services.js";
import { parseBidNo, findNotice } from "../lookup.js";
import { val, joinLines, sourceFooter, NOT_FOUND, g2bLink } from "../../common/format.js";
import { KIND_ENUM } from "./search_bids.js";

export default {
  name: "g2b_bid_changes",
  title: "공고 변경이력",
  description:
    "입찰공고의 변경이력(변경일시·변경항목·변경 전/후 값)을 시간순으로 보여준다. 공사·용역·물품만 제공된다(외자는 API 미제공).",
  inputSchema: {
    bid_no: z.string().describe("입찰공고번호 또는 나라장터 공고 링크"),
    kind: KIND_ENUM.exclude(["전체", "외자"]).optional().describe("업무구분을 알면 지정"),
  },
  async run(a) {
    const { no } = parseBidNo(a.bid_no);
    const budget = new Budget(20);
    const f = await findNotice(no, { kind: a.kind, budget });
    const kind = f.kind || a.kind;
    if (!kind) return joinLines([`${NOT_FOUND} 입찰공고번호 ${no}를 찾지 못했습니다.`, sourceFooter(["bid"])]);
    if (kind === "외자") return "외자 공고는 변경이력 오퍼레이션이 제공되지 않습니다.";
    const op = `getBidPblancListInfoChgHstry${KINDS[kind].suffix}`;
    const r = await callAll("bid", op, { inqryDiv: 2, bidNtceNo: no }, { maxRows: 300, budget });
    const rows = r.items.filter((x) => val(x.bidNtceNo) === no);
    if (!rows.length) {
      const latest = [...f.items].sort((x, y) => val(y.bidNtceOrd).localeCompare(val(x.bidNtceOrd)))[0];
      const changed = latest && /변경|정정/.test(val(latest.ntceKindNm));
      return joinLines([
        `[공고 변경이력] ${no} (${kind})`,
        changed
          ? `${NOT_FOUND} 이 공고는 ${val(latest.ntceKindNm)}(차수 ${val(latest.bidNtceOrd)})로 표시되지만 변경이력 API에는 기록이 없습니다.${val(latest.chgNtceRsn) ? ` 공고에 적힌 사유: ${val(latest.chgNtceRsn)}.` : ""} 바뀐 내용은 원문에서 확인하세요.`
          : `${NOT_FOUND} API에 변경이력이 없습니다(변경된 적 없거나 미등록).`,
        `원문: ${g2bLink(no, latest ? val(latest.bidNtceOrd) : undefined)}`,
        sourceFooter(["bid"]),
      ]);
    }
    rows.sort((x, y) => val(x.chgDt).localeCompare(val(y.chgDt)));
    const body = rows.map((x) => {
      const exec = [val(x.bidNtceOrd) && `차수 ${val(x.bidNtceOrd)}`, val(x.rbidNo) && val(x.rbidNo) !== "000" ? `재입찰 ${val(x.rbidNo)}` : ""].filter(Boolean).join(" · ");
      return joinLines([
        `■ ${val(x.chgDt)} · ${val(x.chgItemNm) || "(항목명 없음)"}${val(x.chgDataDivNm) ? ` [${val(x.chgDataDivNm)}]` : ""}${exec ? ` · ${exec}` : ""}`,
        `  변경 전: ${val(x.bfchgVal) || "(빈 값)"}`,
        `  변경 후: ${val(x.afchgVal) || "(빈 값)"}`,
        val(x.lcnsLmtCdRgstList) ? `  면허제한 변경후: ${val(x.lcnsLmtCdRgstList)}` : null,
      ]);
    });
    return joinLines([
      `[공고 변경이력] ${no} (${kind}) · ${rows.length}건${r.truncated ? ` (API 집계 ${r.total}건 중 일부)` : ""}`,
      "",
      body.join("\n"),
      "",
      `원문: ${g2bLink(no)}`,
      sourceFooter(["bid"]),
    ]);
  },
};
