// D2B 도구 테스트 — 응답은 XML(명세상 produces application/xml). 필드명은 Swagger 명세 그대로.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/d2b/server.js";
import { configureClient, parseBody } from "../src/common/client.js";
import { parseXml } from "../src/common/xml.js";
import { addDays, todayYmd } from "../src/common/dates.js";

const ENV = { DATA_GO_KR_SERVICE_KEY: "test-key", MY_BIZNO: "1234567890" };
const text = (r) => r.content.map((c) => c.text).join("\n");

const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const itemXml = (o) => `<item>${Object.entries(o).map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join("")}</item>`;
const listXml = (items, total = items.length) =>
  `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>${items.map(itemXml).join("")}</items><numOfRows>100</numOfRows><pageNo>1</pageNo><totalCount>${total}</totalCount></body></response>`;
const detailXml = (o) =>
  `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body>${itemXml(o)}</body></response>`;

const BID = {
  pblancYear: "2026", pblancDate: "20261005", pblancSeCode: "1", pblancSe: "정상공고", pblancNo: "2026-F-123", pblancOdr: "1",
  g2bPblancNo: "", cntrwkNo: "26-OO-001", cntrwkNm: "OO부대 막사 신축 설계용역", ornt: "국방시설본부 경기북부시설단", orntCode: "D123",
  bidPartcptRegistClosDt: "202610201800", biddocPresentnClosDt: "202610221000", opengDt: "202610221100", cntrctMth: "제한경쟁", bidStle: "전자입찰",
  baseAmnt: "350000000", bsisPrdprcApplcAt: "적용", busiDivs: "용역",
};
const BID2 = { ...BID, pblancNo: "2026-F-200", cntrwkNo: "26-OO-002", cntrwkNm: "OO부대 정비고 신축공사", busiDivs: "공사", ornt: "국방시설본부 경기북부시설단" };
const BID3 = { ...BID, pblancNo: "2026-F-300", cntrwkNo: "26-XX-003", cntrwkNm: "XX사령부 설계용역 & 감리", ornt: "해군 군수사령부", orntCode: "N900" };

function makeFetch(over = {}) {
  const calls = [];
  const f = async (url) => {
    const u = new URL(url);
    const op = u.pathname.split("/").pop();
    const p = Object.fromEntries(u.searchParams);
    calls.push({ op, p });
    let body;
    if (over[op]) body = over[op](p);
    else switch (op) {
      case "getFcltyCmpetBidPblancList": body = listXml([BID, BID2, BID3]); break;
      case "getFcltyOthbcVltrnNtatPlanList": body = listXml([]); break;
      case "getFcltyCmpetBidPblancDetail": body = detailXml({ ...BID, pblictInstt: "국방시설본부", cntrwkSe: "기술용역", budgetAmount: "400000000", lc: "경기도 OO시", scale: "연면적 3,200㎡", cntrwkPd: "착수일로부터 300일", cntrwkSumry: "막사 신축 기본·실시설계", estmPrce: "363636363", asessRtLwlt: "-2", asessRtUplmt: "+2", scsbidLwltRt: "87.745", lcnsLmttList: "[4817] 건축사사무소^[4967] 건설엔지니어링업", areaLmttList: "전국", chargerNm: "홍담당", chargerCttpc: "02-000-0000", sptDcMeetngDt: "202610151400", copertnOutsrcFlflMthd: "공동이행" }); break;
      case "getFcltyCmpetBidResultList": body = listXml([{ pblancSe: "정상공고", pblancNo: "2026-F-123", pblancOdr: "1", cntrwkNo: "26-OO-001", cntrwkNm: BID.cntrwkNm, ornt: BID.ornt, orntCode: "D123", cntrctMth: "제한경쟁", bidMth: "총액", sucbidrDecsnMth: "적격심사제", opengDt: "2026-10-22 11:00", bidResult: "낙찰", opengDate: "20261022" }]); break;
      case "getFcltyCmpetBidResultDetail": body = detailXml({ pblancNo: "2026-F-123", pblancOdr: "1", cntrwkNo: "26-OO-001", cntrwkNm: BID.cntrwkNm, ornt: BID.ornt, budgetAmount: "400000000", bsisPreparPc: "350000000", asessRtLwlt: "-2", asessRtUplmt: "+2", scsbidLwltRt: "87.745", bidResult: "낙찰", scsbidEntrpsNm: "다른건축", scsbidEntrpsBsnmRegistNo: "2222222222" }); break;
      case "getFcltyCmpetBidResultMnufList": body = listXml([
        { mnufCode: "A", tbidAmnt: "310000000", bidnRate: "88.1", bidnRank: "2", propExgd: "95.5", mfkrName: "주식회사 테스트건축사사무소", rptrKore: "대표자", bznsRgnb: "1234567890", bidxRslt: "" },
        { mnufCode: "B", tbidAmnt: "305000000", bidnRate: "87.9", bidnRank: "1", propExgd: "96.0", mfkrName: "다른건축", rptrKore: "대표자2", bznsRgnb: "1111111111", bidxRslt: "낙찰" },
      ]); break;
      case "getFcltyCmpetBidResultBsicList": body = listXml([{ epprRank: "1", planPrce: "349000000", choiYsno: "Y" }, { epprRank: "2", planPrce: "351000000", choiYsno: "N" }]); break;
      case "getFcltyPrcurePlanList": body = listXml([{ orderPrearngeMt: "202612", cntrwkNo: "26-OO-009", cntrwkNm: "OO부대 탄약고 설계", cntrwkSe: "용역", ornt: "국방시설본부", orntCode: "D123", budgetAmount: "120000000", cntrctMth: "제한경쟁", progrsSttus: "계획" }]); break;
      case "getFcltyPrcurePlanDetail": body = detailXml({ cntrwkNo: "26-OO-001", cntrwkNm: BID.cntrwkNm, ornt: BID.ornt, cntrwkSe: "용역", orderPrearngeMt: "202609", bidPrearngeDate: "20261005", totBudgetAmount: "400000000", prtintYearBudgetAmount: "200000000", lc: "경기도 OO시", scale: "3,200㎡" }); break;
      case "getFcltyCntrctInfoList": body = listXml([{ cntrctDate: "20261101", cntrctNo: "C-1", cntrwkNo: "26-OO-001", cntrctNm: BID.cntrwkNm, ornt: BID.ornt, cntrctEntrpsNm: "다른건축", cntrctAmnt: "305000000", cntrctBidnRate: "87.9", cntrctDivs: "용역" }, { cntrctDate: "20261102", cntrctNo: "C-2", cntrwkNo: "99-ZZ-999", cntrctNm: BID.cntrwkNm + " (다른 사업)", ornt: BID.ornt, cntrctEntrpsNm: "제3자", cntrctAmnt: "1" }]); break;
      default: body = "<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>12</returnReasonCode><returnAuthMsg>NO_OPENAPI_SERVICE_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>";
    }
    return { ok: true, status: 200, text: async () => body };
  };
  f.calls = calls;
  return f;
}

async function connect(fetchImpl, env = ENV) {
  const server = createServer(env);
  configureClient({ fetch: fetchImpl });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const c = new Client({ name: "t", version: "1" });
  await c.connect(ct);
  return c;
}

test("XML 파서·봉투: 목록/상세/단건/빈 목록/엔티티", () => {
  assert.deepEqual(parseBody(listXml([{ a: "1" }, { a: "2" }])).items, [{ a: "1" }, { a: "2" }]);
  assert.deepEqual(parseBody(listXml([{ a: "x & y <z>" }])).items, [{ a: "x & y <z>" }]);
  assert.equal(parseBody(listXml([], 0)).total, 0);
  assert.deepEqual(parseBody(detailXml({ b: "2" })).items, [{ b: "2" }]);
  assert.deepEqual(parseXml("<r><v><![CDATA[<b>]]></v></r>"), { r: { v: "<b>" } });
  assert.throws(() => parseBody(`<response><header><resultCode>30</resultCode><resultMsg>SERVICE KEY IS NOT REGISTERED</resultMsg></header></response>`), /등록되지 않은 인증키/);
});

test("도구 13개, 모두 d2b_ 접두어, 저장하는 도구 외 읽기 전용", async () => {
  const c = await connect(makeFetch());
  const { tools } = await c.listTools();
  assert.equal(tools.length, 13, "진단 도구(d2b_raw)는 BR_DIAG=1일 때만");
  assert.ok(tools.every((t) => t.name.startsWith("d2b_")));
  const writes = ["d2b_update", "d2b_keywords", "d2b_briefing"];
  assert.ok(tools.filter((t) => !writes.includes(t.name)).every((t) => t.annotations?.readOnlyHint));
});

test("d2b_search_bids: 용역만, 기관명 거르기, 공고일 파라미터, 공개수의 0건", async () => {
  const f = makeFetch();
  const c = await connect(f);
  const t = text(await c.callTool({ name: "d2b_search_bids", arguments: { institution: "국방시설본부", from: "2026-10-01", to: "2026-10-15" } }));
  assert.match(t, /OO부대 막사 신축 설계용역/);
  assert.ok(!/정비고 신축공사/.test(t), "공사는 제외(기본 용역)");
  assert.ok(!/XX사령부/.test(t), "다른 기관 제외");
  assert.match(t, /참가등록마감 202610201800/);
  assert.match(t, /기초예비가격 350,000,000원/);
  const call = f.calls.find((x) => x.op === "getFcltyCmpetBidPblancList");
  assert.equal(call.p.anmtDateBegin, "20261001");
  assert.equal(call.p.anmtDateEnd, "20261015");
  assert.equal(call.p.type, undefined, "D2B에는 type=json을 붙이지 않음");
  assert.match(t, /공개수의협상계획[\s\S]*\[NOT_FOUND\]/);
});

test("d2b_bid_detail: 목록에서 찾아 상세 파라미터로 조회, 면허 목록 분리", async () => {
  const f = makeFetch();
  const c = await connect(f);
  const t = text(await c.callTool({ name: "d2b_bid_detail", arguments: { bid_no: "2026-F-123", from: "2026-10-01" } }));
  const d = f.calls.find((x) => x.op === "getFcltyCmpetBidPblancDetail");
  assert.deepEqual({ y: d.p.pblancYear, se: d.p.pblancSeCode, no: d.p.pblancNo, o: d.p.pblancOdr, c: d.p.cntrwkNo, oc: d.p.orntCode }, { y: "2026", se: "1", no: "2026-F-123", o: "1", c: "26-OO-001", oc: "D123" });
  assert.match(t, /위치: 경기도 OO시/);
  assert.match(t, /\[4817\] 건축사사무소\n\s+\[4967\] 건설엔지니어링업/);
  assert.match(t, /낙찰하한율: 87\.745%/);
  assert.match(t, /판정 아님/);
});

test("d2b_bid_result: 낙찰업체 vs 순위 1위 불일치 표시, 우리 회사 ★, 대표자명 미출력, 선택 예가", async () => {
  const c = await connect(makeFetch());
  const t = text(await c.callTool({ name: "d2b_bid_result", arguments: { bid_no: "2026-F-123", from: "2026-10-01" } }));
  assert.match(t, /낙찰업체: 다른건축 \(222-22-22222\)/);
  assert.match(t, /⚠ 불일치: 상세의 낙찰업체\(다른건축\)와 순위표 1위\(다른건축\)/);
  assert.match(t, /2위 주식회사 테스트건축사사무소 \(123-45-67890\) ★/);
  assert.match(t, /선택된 순번 1/);
  assert.ok(!/대표자/.test(t));
});

test("d2b_project: 공사번호가 같은 계약만 연결(이름 비슷한 다른 사업 제외)", async () => {
  const c = await connect(makeFetch());
  const t = text(await c.callTool({ name: "d2b_project", arguments: { cntrwk_no: "26-OO-001", ornt_code: "D123" } }));
  assert.match(t, /입찰예정 20261005/);
  assert.match(t, /계약번호 C-1/);
  assert.ok(!/C-2|제3자/.test(t), "다른 공사번호 계약은 붙이지 않음");
  assert.match(t, /OO부대 막사 신축 설계용역 — 낙찰/);
});

test("d2b_plans·d2b_contracts·d2b_raw", async () => {
  const f = makeFetch();
  const c = await connect(f);
  const p = text(await c.callTool({ name: "d2b_plans", arguments: { from_month: "2026-10", to_month: "2027-03" } }));
  assert.match(p, /202612 발주예정 · OO부대 탄약고 설계/);
  const pc = f.calls.find((x) => x.op === "getFcltyPrcurePlanList");
  assert.deepEqual([pc.p.orderPrearngeMtBegin, pc.p.orderPrearngeMtEnd], ["202610", "202703"]);
  const k = text(await c.callTool({ name: "d2b_contracts", arguments: { company: "다른건축", from: "2026-11-01", to: "2026-11-30" } }));
  assert.match(k, /계약업체 다른건축 · 계약금액 305,000,000원/);
  assert.ok(!/제3자/.test(k));
  // 진단 도구는 서버에 노출되지 않음(BR_DIAG=1일 때만) — 모듈을 직접 실행해 동작만 확인
  const { tools } = await c.listTools();
  assert.ok(!tools.some((t) => t.name === "d2b_raw"));
  const { default: raw } = await import("../src/d2b/tools/raw.js");
  const r = await raw.run({ service: "result", operation: "getFcltyCmpetBidResultMnufList", params: { cntrwkNo: "26-OO-001" } });
  assert.match(r, /"rptrKore": "\(숨김\)"/);
  const bad = await raw.run({ service: "plan", operation: "evilOp" });
  assert.match(bad, /없는 오퍼레이션/);
});

test("d2b_check_setup: 서비스별 승인 오류 구분", async () => {
  const f = makeFetch({
    getFcltyCntrctInfoList: () => "<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>20</returnReasonCode><returnAuthMsg>SERVICE_ACCESS_DENIED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>",
  });
  const c = await connect(f);
  const t = text(await c.callTool({ name: "d2b_check_setup", arguments: {} }));
  assert.match(t, /✓ 방위사업청 군수품조달정보 입찰공고 — 정상 \(시설 전체 3건\)/);
  assert.match(t, /✗ 방위사업청 군수품조달정보 계약정보 — 이 서비스에 대한 활용승인이 없습니다/);
});

test("공개수의: 오래된 순 목록은 마지막 페이지부터 읽고, 마감 전 건이 보이도록 앞으로 30일까지 조회", async () => {
  // 450건, 오래된 순(1번이 가장 오래됨). 페이지 크기 100 → 마지막 페이지(5)에 최신 50건
  const N = 450;
  const nego = (i) => ({ pblancNo: `NEG${String(i).padStart(4, "0")}`, pblancOdr: "1", cntrwkNo: `2026-${i}`, cntrwkNm: `용역 ${i}`, ornt: "제1부대", orntCode: "L1", busiDivs: "용역", progrsSttus: "공개협상", budgetAmount: "1000", prqudoPresentnClosDt: `${addDays("20260901", Math.floor(i / 10))}1000` });
  const f = makeFetch({
    getFcltyCmpetBidPblancList: () => listXml([]),
    getFcltyOthbcVltrnNtatPlanList: (p) => {
      const size = Number(p.numOfRows), page = Number(p.pageNo);
      const ids = Array.from({ length: N }, (_, k) => k + 1).slice((page - 1) * size, page * size);
      return listXml(ids.map(nego), N);
    },
  });
  const c = await connect(f);
  const out = text(await c.callTool({ name: "d2b_search_bids", arguments: { limit: 5 } }));
  const negoCalls = f.calls.filter((x) => x.op === "getFcltyOthbcVltrnNtatPlanList");
  assert.ok(negoCalls.some((x) => x.p.pageNo === "5"), "마지막 페이지를 읽어야 함");
  assert.ok(out.includes("NEG0450"), "가장 최신 건이 보여야 함");
  const ends = negoCalls.map((x) => x.p.prqudoPresentnClosDateEnd).filter(Boolean).sort();
  assert.equal(ends.at(-1), addDays(todayYmd(), 30), "견적서 마감일 조회는 30일 뒤까지");
});

test("나라장터 연계번호는 '공고번호'로 표시하지 않는다", async () => {
  const f = makeFetch({ getFcltyCmpetBidPblancList: () => listXml([{ ...BID, g2bPblancNo: "2026SFC00632026-15676", g2bPblancOdr: "01" }]) });
  const c = await connect(f);
  const out = text(await c.callTool({ name: "d2b_search_bids", arguments: { include_negotiation: false } }));
  assert.match(out, /나라장터 연계번호 2026SFC00632026-15676 \(차수 01\)/);
  assert.doesNotMatch(out, /나라장터 공고번호/);
});

test("취소된 건은 ⚠ 표시하고 진행 중인 건 뒤로 보낸다", async () => {
  const neg = (no, st, d) => ({ pblancNo: no, pblancOdr: "1", cntrwkNo: no, cntrwkNm: `용역 ${no}`, ornt: "제1부대", orntCode: "L1", busiDivs: "용역", progrsSttus: st, prqudoPresentnClosDt: `${d}1000` });
  const f = makeFetch({
    getFcltyCmpetBidPblancList: () => listXml([{ ...BID, pblancNo: "C-1", pblancSe: "취소공고", pblancDate: "20261014" }, { ...BID, pblancNo: "A-1", pblancDate: "20261001" }]),
    getFcltyOthbcVltrnNtatPlanList: () => listXml([neg("N-CXL", "공개협상취소", "20261030"), neg("N-OK", "진행중", "20261020")]),
  });
  const c = await connect(f);
  const out = text(await c.callTool({ name: "d2b_search_bids", arguments: {} }));
  assert.ok(out.indexOf("A-1") < out.indexOf("C-1"), "경쟁: 진행 중 먼저");
  assert.ok(out.indexOf("N-OK") < out.indexOf("N-CXL"), "공개수의: 진행 중 먼저");
  assert.match(out, /용역 N-CXL ⚠ 취소/);
  assert.match(out, /취소 \d+건은 맨 뒤/); // 모의 응답은 월 창마다 같은 목록
});

test("D2B 원문 링크 — 실제 사이트에서 열리는 것을 확인한 주소와 같게 만든다(2026-10-15)", async () => {
  const { d2bBidLink, d2bNegoLink } = await import("../src/d2b/lib.js");
  assert.equal(
    d2bBidLink({ orntCode: "MCM", pblancSeCode: "B", pblancNo: "MCM0003", pblancOdr: "1", cntrwkNo: "2026-15349", pblancYear: "2026" }),
    "https://www.d2b.go.kr/peb/bid/announceView.do?dprt_code=MCM&anmt_divs=B&anmt_numb=MCM0003&rqst_degr=1&dcsn_numb=2026-15349&rqst_year=2026&lv1_divs=PEB&lv2Divs=1&pageDivs=E1",
  );
  assert.equal(
    d2bNegoLink({ orntCode: "LPN", pblancNo: "LPN0166", pblancOdr: "2", cntrwkNo: "2026-15966", ntatPlanDate: "20261015" }),
    "https://www.d2b.go.kr/peb/openNego/openNegoPlanView.do?dprt_code=LPN&anmt_numb=LPN0166&negn_degr=2&csrt_numb=2026-15966&ordr_year=2026&negn_pldt=20261015&pageDivs=E&list_url=%2Fpeb%2Fbid%2FannounceList.do",
  );
  assert.equal(d2bBidLink({ orntCode: "MCM", pblancNo: "MCM0003" }), "", "값이 빠지면 링크를 만들지 않음");
  const c = await connect(makeFetch());
  const out = text(await c.callTool({ name: "d2b_search_bids", arguments: { include_negotiation: false } }));
  assert.match(out, /https:\/\/www\.d2b\.go\.kr\/peb\/bid\/announceView\.do\?dprt_code=D123/);
});

test("순위 '0000'(순위외)은 뒤로, 불일치 경고는 순위 있는 1위와 비교(실측 반영)", async () => {
  const f = makeFetch({
    getFcltyCmpetBidResultDetail: () => detailXml({ pblancNo: "2026-F-123", pblancOdr: "1", cntrwkNo: "26-OO-001", cntrwkNm: BID.cntrwkNm, bidResult: "순위확정", scsbidEntrpsNm: "낙찰건축", scsbidEntrpsBsnmRegistNo: "3333333333", scsbidLwltRt: "0" }),
    getFcltyCmpetBidResultMnufList: () => listXml([
      { bidnRank: "0000", tbidAmnt: "290000000", bidnRate: "84.1", mfkrName: "하한미만건축", bznsRgnb: "4444444444", propExgd: "0", bidxRslt: "0", bidxNote: "낙찰하한가미만" },
      { bidnRank: "0001", tbidAmnt: "300000000", bidnRate: "85.5", mfkrName: "낙찰건축", bznsRgnb: "3333333333", propExgd: "0", bidxNote: "1순위" },
    ]),
  });
  const c = await connect(f);
  const out = text(await c.callTool({ name: "d2b_bid_result", arguments: { bid_no: "2026-F-123" } }));
  assert.ok(out.indexOf("1위 낙찰건축") < out.indexOf("순위외 하한미만건축"), out);
  assert.doesNotMatch(out, /⚠ 불일치/);
  assert.doesNotMatch(out, /0위|적격심사 0/);
  assert.match(out, /순위 1 · 순위외 1/);
  assert.match(out, /낙찰하한율 -/);
});

test("마감된 경쟁입찰공고: 목록에 없으면 결과 목록의 키로 상세를 직접 조회", async () => {
  const closedRes = { pblancSe: "긴급공고", pblancNo: "UMM0919", pblancOdr: "1", cntrwkNo: "2026-15121", cntrwkNm: "건설폐기물처리용역(A246)", ornt: "국군재정관리단", orntCode: "UMM", opengDate: "20261013", opengDt: "202610131100", bidResult: "순위확정" };
  const f = makeFetch({
    getFcltyCmpetBidPblancList: () => listXml([]),
    getFcltyCmpetBidResultList: () => listXml([closedRes]),
    getFcltyCmpetBidPblancDetail: (p) => p.pblancSeCode === "B" && p.pblancYear === "2026"
      ? detailXml({ ...closedRes, pblancDate: "20261006", budgetAmount: "708715000", scsbidLwltRt: "85.495", lcnsLmttList: "[1143] 폐기물종합처분업|[1253] 건설폐기물 중간처리업", g2bPblancNo: "UMM09192026-15121", g2bPblancOdr: "01", registJdgmnPnttm: "F", cobaAmnt: "0", baseEnam: "0", baseCoam: "0" })
      : listXml([], 0),
  });
  const c = await connect(f);
  const out = text(await c.callTool({ name: "d2b_bid_detail", arguments: { bid_no: "UMM0919" } }));
  assert.match(out, /경쟁\(마감\)/);
  assert.match(out, /\[1143\] 폐기물종합처분업\n\s+\[1253\] 건설폐기물 중간처리업/, "| 구분자도 나눔");
  assert.match(out, /나라장터 연계번호: 2026UMM09192026-15121 \(차수 01\)/, "연도 보충");
  assert.match(out, /입찰서 제출마감 후 등록심사/);
  assert.doesNotMatch(out, /평가기준금액|기초금액\(토목/, "0원 항목 숨김");
  assert.match(out, /지역제한: API에서 제공하지 않음/);
  assert.match(out, /anmt_divs=B&anmt_numb=UMM0919/);
});

test("계약: 장기계속은 총부기금액이 클 때만 차수 표시, 낙찰금액 함께", async () => {
  const { contractBlock } = await import("../src/d2b/tools/contracts.js");
  const lt = contractBlock({ cntrctNm: "설계용역", cntrctAmnt: "309697000", cntrctSccsBidAmnt: "482368000", cntrctPlanaAmnt: "564167225", cntrctBidnRate: "85.5", cntrctTotlCsrtBokpAmnt: "482368000", cntrctLtmDegr: "1", cntrctContStdt: "20261015", cntrctContCldt: "20271114" });
  assert.match(lt, /이번 차수분/);
  assert.match(lt, /장기계속 1차 \(총부기금액 482,368,000원/);
  assert.match(lt, /낙찰금액 482,368,000원/);
  const one = contractBlock({ cntrctNm: "점검", cntrctAmnt: "10400000", cntrctTotlCsrtBokpAmnt: "10400000", cntrctLtmDegr: "1", cntrctContStdt: "20261015", cntrctContCldt: "20261215" });
  assert.doesNotMatch(one, /장기|차수분/);
});

test("D2B 결과 원문 링크 — 확인한 주소 형식(2026-10-15)", async () => {
  const { d2bResultLink } = await import("../src/d2b/lib.js");
  assert.equal(
    d2bResultLink({ orntCode: "UMM", cntrwkNo: "2026-15121", opengDate: "20261013", pblancNo: "UMM0919", pblancOdr: "1" }),
    "https://www.d2b.go.kr/peb/bid/bidResultView.do?ordr_year=2026&dprt_code=UMM&dcsn_numb=2026-15121&csrt_numb=2026-15121&benf_pldt=20261013&anmt_numb=UMM0919&rqst_degr=1&benf_degr=1&lvDivs2=BID&pageDivs=E",
  );
  assert.equal(d2bResultLink({ orntCode: "UMM", cntrwkNo: "26-OO-001", opengDate: "20261013", pblancNo: "X", pblancOdr: "1" }), "", "연도 없는 공사번호면 생략");
});
