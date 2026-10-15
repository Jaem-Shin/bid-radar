// 0.1.0 기능: 관심 키워드·신규 공고 브리핑·마감 일정판·참가자격 점검 (G2B·D2B)
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer as g2bServer } from "../src/g2b/server.js";
import { createServer as d2bServer } from "../src/d2b/server.js";
import { configureClient } from "../src/common/client.js";
import { nowKst, ymd, addDays } from "../src/common/dates.js";
import { makeFetch as g2bFetch, ok } from "./g2b.mock.js";

const text = (r) => r.content.map((c) => c.text).join("\n");
async function connect(make, env, fetchImpl) {
  const server = make(env);
  configureClient({ fetch: fetchImpl });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const c = new Client({ name: "t", version: "1" });
  await c.connect(ct);
  return c;
}
const ENV = { DATA_GO_KR_SERVICE_KEY: "test-key", MY_BIZNO: "123-45-67890" };
const BIZ = "1234567890";
// 오늘 기준 KST 일시 문자열
const kst = (days, hh = "10:00") => { const d = nowKst(); d.setUTCDate(d.getUTCDate() + days); const y = ymd(d); return `${y.slice(0, 4)}-${y.slice(4, 6)}-${y.slice(6)} ${hh}:00`; };
const d8 = (days) => addDays(ymd(nowKst()), days);

beforeEach(() => { process.env.BR_DATA_DIR = mkdtempSync(join(tmpdir(), "br-watch-")); });

test("관심 키워드: 추가·삭제·중복 제거, G2B·D2B가 같은 파일을 쓴다", async () => {
  const g = await connect(g2bServer, ENV, g2bFetch());
  let t = text(await g.callTool({ name: "g2b_keywords", arguments: { add: ["설계", " 설계 ", "건설사업관리"] } }));
  assert.match(t, /\[관심 키워드\] 설계, 건설사업관리/);
  const d = await connect(d2bServer, ENV, async () => ({ ok: true, status: 200, text: async () => "" }));
  t = text(await d.callTool({ name: "d2b_keywords", arguments: { add: ["감리"], remove: ["설계"] } }));
  assert.match(t, /\[관심 키워드\] 건설사업관리, 감리/);
  const saved = JSON.parse(readFileSync(join(process.env.BR_DATA_DIR, "watch.json"), "utf8"));
  assert.deepEqual(saved.keywords, ["건설사업관리", "감리"]);
});

test("G2B 브리핑: 키워드별 공고·사전규격을 합치고(중복 1건), 브리핑 시각을 기억", async () => {
  const n1 = { bidNtceNo: "R26BK00000001", bidNtceOrd: "000", bidNtceNm: "OO 설계 및 건설사업관리 용역", ntceKindNm: "등록공고", ntceInsttNm: "국군재정관리단", bidNtceDt: kst(0, "09:00"), bidClseDt: kst(5), opengDt: kst(5, "11:00") };
  const n2 = { ...n1, bidNtceNo: "R26BK00000002", bidNtceNm: "XX 건설사업관리 용역" };
  const calls = [];
  const f = g2bFetch({
    getBidPblancListInfoServcPPSSrch: (p) => { calls.push(p); return ok(p.bidNtceNm === "설계" ? [n1] : [n1, n2]); },
    getPublicPrcureThngInfoServcPPSSrch: (p) => ok(p.prdctClsfcNoNm === "설계" ? [{ bfSpecRgstNo: "R26BD00000009", prdctClsfcNoNm: "OO 설계용역", orderInsttNm: "OO시", rgstDt: kst(0, "08:00"), opninRgstClseDt: kst(3) }] : []),
  });
  const c = await connect(g2bServer, ENV, f);
  await c.callTool({ name: "g2b_keywords", arguments: { add: ["설계", "건설사업관리"] } });
  const t = text(await c.callTool({ name: "g2b_briefing", arguments: {} }));
  assert.match(t, /◆ 입찰공고 2건/);
  assert.match(t, /키워드: 설계, 건설사업관리/, "두 키워드에 걸린 공고는 한 번만, 키워드 함께 표시");
  assert.match(t, /◆ 사전규격 1건/);
  assert.match(t, /다음 브리핑은 이번에 보여준 건을 빼고/);
  const t2 = text(await c.callTool({ name: "g2b_briefing", arguments: {} }));
  assert.match(t2, /◆ 입찰공고 0건/, "두 번째엔 이미 본 건 제외(30분 겹쳐 조회해도)");
  const saved = JSON.parse(readFileSync(join(process.env.BR_DATA_DIR, "watch.json"), "utf8"));
  assert.ok(saved.lastBrief.g2b, "브리핑 시각 저장");
  assert.ok(calls.every((p) => /^\d{12}$/.test(p.inqryBgnDt)), "분 단위 조회");
});

test("G2B 마감 일정판: 앞으로 N일 일정을 날짜순, 취소공고 제외", async () => {
  const live = { bidNtceNo: "R26BK00000003", bidNtceOrd: "000", bidNtceNm: "OO 설계용역", ntceKindNm: "등록공고", ntceInsttNm: "국방부", bidQlfctRgstDt: kst(2, "18:00"), bidClseDt: kst(4), opengDt: kst(4, "11:00") };
  const past = { ...live, bidNtceNo: "R26BK00000004", bidNtceNm: "지난 설계", bidQlfctRgstDt: kst(-3), bidClseDt: kst(-2), opengDt: kst(-2) };
  const cxl = { ...live, bidNtceNo: "R26BK00000005", bidNtceNm: "취소된 설계", ntceKindNm: "취소공고" };
  const c = await connect(g2bServer, ENV, g2bFetch({ getBidPblancListInfoServcPPSSrch: () => ok([live, past, cxl]) }));
  const t = text(await c.callTool({ name: "g2b_deadlines", arguments: { keywords: ["설계"], days: 7 } }));
  assert.ok(t.indexOf("참가자격 등록마감") < t.indexOf("입찰마감"), t);
  assert.match(t, /D-2/);
  assert.doesNotMatch(t, /지난 설계|취소된 설계/);
});

test("G2B 참가자격: 그룹별 대조(같은 그룹 모두·그룹 중 하나), 허용업종 인정, 만료 표시", async () => {
  const lic = (grp, nm, alt) => ({ bidNtceNo: "R25BK00933736", bidNtceOrd: "000", lmtGrpNo: grp, lcnsLmtNm: nm, permsnIndstrytyList: alt || "" });
  const f = g2bFetch({
    getBidPblancListInfoLicenseLimit: () => ok([lic("1", "건축사사무소/4817"), lic("1", "소방시설설계업/1490"), lic("2", "엔지니어링사업(건축)/3599", "[3585^엔지니어링사업(구조)]")]),
    getBidPblancListInfoPrtcptPsblRgn: () => ok([{ bidNtceNo: "R25BK00933736", bidNtceOrd: "000", prtcptPsblRgnNm: "서울특별시" }]),
    getPrcrmntCorpIndstrytyInfo02: () => ok([
      { bizno: BIZ, indstrytyCd: "4817", indstrytyNm: "건축사사무소", vldPrdExprtDt: "2099-01-01 00:00:00", indstrytyStatsNm: "정상" },
      { bizno: BIZ, indstrytyCd: "3585", indstrytyNm: "엔지니어링사업(구조)" },
      { bizno: BIZ, indstrytyCd: "1490", indstrytyNm: "일반소방시설설계업(기계)", vldPrdExprtDt: "2000-01-01 00:00:00" },
    ]),
    getPrcrmntCorpBasicInfo02: () => ok([{ bizno: BIZ, corpNm: "주식회사 테스트건축", rgnNm: "서울특별시 종로구", adrs: "새문안로" }]),
  });
  const c = await connect(g2bServer, ENV, f);
  const t = text(await c.callTool({ name: "g2b_eligibility", arguments: { bid_no: "R25BK00933736", kind: "용역" } }));
  assert.match(t, /판정: ✓ 면허 조건 충족 \(그룹 2\)/, t);
  assert.match(t, /그룹 1: ✓ 건축사사무소\[4817\] \+ ⚠ 소방시설설계업\[1490\]/);
  assert.match(t, /허용업종 엔지니어링사업\(구조\) 보유/);
  assert.match(t, /공고: 서울특별시/);
  assert.match(t, /같은 그룹의 면허는 모두/);
});

// ── D2B
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const itemXml = (o) => `<item>${Object.entries(o).map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join("")}</item>`;
const listXml = (items) => `<?xml version="1.0"?><response><header><resultCode>00</resultCode><resultMsg>OK</resultMsg></header><body><items>${items.map(itemXml).join("")}</items><numOfRows>100</numOfRows><pageNo>1</pageNo><totalCount>${items.length}</totalCount></body></response>`;
const detailXml = (o) => `<?xml version="1.0"?><response><header><resultCode>00</resultCode><resultMsg>OK</resultMsg></header><body>${itemXml(o)}</body></response>`;
function d2bFetch(routes) {
  return async (url) => {
    const u = new URL(url);
    const op = u.pathname.split("/").pop();
    const p = Object.fromEntries(u.searchParams);
    const body = routes[op] ? routes[op](p) : op === "getPrcrmntCorpIndstrytyInfo02" ? ok([]) : listXml([]);
    return { ok: true, status: 200, text: async () => body };
  };
}
const BID = { pblancYear: "2026", pblancSeCode: "A", pblancSe: "정상공고", pblancNo: "LHQ0172", pblancOdr: "1", cntrwkNo: "2026-16204", orntCode: "LHQ", ornt: "제2작전사령부", cntrwkNm: "26-호우피해 설계용역", busiDivs: "용역", pblancDate: d8(0), bidPartcptRegistClosDt: `${d8(3)}1000`, biddocPresentnClosDt: `${d8(4)}1000`, opengDt: `${d8(4)}1030` };

test("D2B 브리핑: 처음엔 보여주고, 다음엔 이미 본 건을 뺀다", async () => {
  const nego = { pblancNo: "MDG0137", pblancOdr: "1", cntrwkNo: "2026-16171", orntCode: "MDG", ornt: "국군의무사령부", cntrwkNm: "OO 설계용역(재해예방)", busiDivs: "용역", progrsSttus: "진행중", prqudoPresentnClosDt: `${d8(5)}1000`, ntatPlanDate: d8(5) };
  const routes = { getFcltyCmpetBidPblancList: () => listXml([BID]), getFcltyOthbcVltrnNtatPlanList: () => listXml([nego]) };
  const c = await connect(d2bServer, ENV, d2bFetch(routes));
  await c.callTool({ name: "d2b_keywords", arguments: { add: ["설계"] } });
  let t = text(await c.callTool({ name: "d2b_briefing", arguments: {} }));
  assert.match(t, /경쟁입찰공고 \(새로 공고됨\) 1건/);
  assert.match(t, /공개수의협상 \(마감 전, 처음 보는 건\) 1건/);
  t = text(await c.callTool({ name: "d2b_briefing", arguments: {} }));
  assert.match(t, /경쟁입찰공고 \(새로 공고됨\) 0건/);
  assert.match(t, /처음 보는 건\) 0건/);
});

test("D2B 마감 일정판: 경쟁 참가등록·입찰서·개찰 + 공개수의 견적서 마감", async () => {
  const nego = { pblancNo: "MDG0137", pblancOdr: "1", cntrwkNo: "2026-16171", orntCode: "MDG", ornt: "국군의무사령부", cntrwkNm: "OO 설계 재해예방", busiDivs: "용역", progrsSttus: "진행중", prqudoPresentnClosDt: `${d8(2)}1000` };
  const c = await connect(d2bServer, ENV, d2bFetch({ getFcltyCmpetBidPblancList: () => listXml([BID]), getFcltyOthbcVltrnNtatPlanList: () => listXml([nego]) }));
  const t = text(await c.callTool({ name: "d2b_deadlines", arguments: { keywords: ["설계"], days: 10 } }));
  assert.ok(t.indexOf("견적서 마감(공개수의)") < t.indexOf("참가등록 마감"), t);
  assert.match(t, /입찰서 마감/);
  assert.match(t, /일정 3개 \(개찰 제외\)/);
  const t2 = text(await c.callTool({ name: "d2b_deadlines", arguments: { keywords: ["설계"], days: 10, include_opening: true } }));
  assert.match(t2, /일정 4개/);
  assert.match(t2, /10:00 입찰서 마감 · 10:30 개찰 — 26-호우피해 설계용역/, "같은 공고 같은 날은 한 줄");
});

test("D2B 참가자격: 면허별 대조, 일부 보유는 판정 보류", async () => {
  const detail = { ...BID, lcnsLmttList: "[3588] 엔지니어링사업(토질, 지질)^[7378] 기술사사무소(토질,지질)" };
  const routes = {
    getFcltyCmpetBidPblancList: () => listXml([BID]),
    getFcltyCmpetBidPblancDetail: () => detailXml(detail),
    getPrcrmntCorpIndstrytyInfo02: () => ok([{ bizno: BIZ, indstrytyCd: "3588", indstrytyNm: "엔지니어링사업(토질, 지질)" }]),
  };
  const c = await connect(d2bServer, ENV, d2bFetch(routes));
  const t = text(await c.callTool({ name: "d2b_eligibility", arguments: { bid_no: "LHQ0172" } }));
  assert.match(t, /✓ 엔지니어링사업\(토질, 지질\)\[3588\]/, t);
  assert.match(t, /✗ 기술사사무소\(토질,지질\)\[7378\]/);
  assert.match(t, /△ 일부만 보유 — 면허 그룹 구성/);
  assert.match(t, /announceView\.do/);
});

test("G2B 브리핑: 취소공고는 목록에서 빼고 건수만, 추정가격 하한", async () => {
  const base = { bidNtceOrd: "000", ntceKindNm: "등록공고", ntceInsttNm: "OO시", bidNtceDt: kst(0, "09:00") };
  const f = g2bFetch({
    getBidPblancListInfoServcPPSSrch: () => ok([
      { ...base, bidNtceNo: "R26BK00000011", bidNtceNm: "큰 설계", presmptPrce: "300000000" },
      { ...base, bidNtceNo: "R26BK00000012", bidNtceNm: "작은 설계", presmptPrce: "5000000" },
      { ...base, bidNtceNo: "R26BK00000013", bidNtceNm: "취소된 설계", ntceKindNm: "취소공고", presmptPrce: "300000000" },
    ]),
    getPublicPrcureThngInfoServcPPSSrch: () => ok([]),
  });
  const c = await connect(g2bServer, ENV, f);
  const t = text(await c.callTool({ name: "g2b_briefing", arguments: { keywords: ["설계"], min_price: 100000000 } }));
  assert.match(t, /◆ 입찰공고 1건/, t);
  assert.match(t, /큰 설계/);
  assert.doesNotMatch(t, /작은 설계|■ .*취소된 설계/);
  assert.match(t, /취소공고 1건은 제외/);
});

test("담당자 표시는 성만 남기고 연락처를 뺀다", async () => {
  const { officer } = await import("../src/common/format.js");
  assert.equal(officer("김진현"), "김** (연락처는 원문에서 로그인 후 확인)");
  assert.equal(officer(""), "");
});
