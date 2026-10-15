import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/g2b/server.js";
import { configureClient, parseBody } from "../src/common/client.js";
import { splitMonths, parseDateInput } from "../src/common/dates.js";
import { parseBidNo } from "../src/g2b/lookup.js";
import { makeFetch, NO, ok } from "./g2b.mock.js";

async function connect(env, fetchImpl) {
  const server = createServer(env);
  configureClient({ fetch: fetchImpl });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(ct);
  return client;
}
const ENV = { DATA_GO_KR_SERVICE_KEY: "test-key", MY_BIZNO: "111-11-11111" };
const text = (r) => r.content.map((c) => c.text).join("\n");

test("도구 13개 노출, 저장하는 도구(키워드·브리핑·업데이트) 외 읽기 전용", async () => {
  const c = await connect(ENV, makeFetch());
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["g2b_bid_changes", "g2b_bid_detail", "g2b_bid_result", "g2b_check_setup", "g2b_company_profile", "g2b_search_awards", "g2b_search_bids", "g2b_search_prespecs", "g2b_update", "g2b_keywords", "g2b_briefing", "g2b_deadlines", "g2b_eligibility"].sort());
  const writes = ["g2b_update", "g2b_keywords", "g2b_briefing"];
  assert.ok(tools.filter((t) => !writes.includes(t.name)).every((t) => t.annotations?.readOnlyHint === true));
  assert.ok(writes.every((n) => tools.find((t) => t.name === n).annotations?.readOnlyHint === false));
});

test("search_bids: 월 분할·출처·링크·변경공고 표시", async () => {
  const f = makeFetch();
  const c = await connect(ENV, f);
  const r = await c.callTool({ name: "g2b_search_bids", arguments: { keyword: "용역", from: "2025-06-15", to: "2025-07-10" } });
  const t = text(r);
  const ops = f.calls.filter((x) => x.op === "getBidPblancListInfoServcPPSSrch");
  const wins = [...new Set(ops.map((x) => `${x.p.inqryBgnDt}-${x.p.inqryEndDt}`))].sort();
  assert.deepEqual(wins, ["202506150000-202506302359", "202507010000-202507102359"], "6월·7월 2개 창");
  assert.ok(ops.every((x) => x.p.bidNtceNm === "용역" && x.p.inqryDiv === "1" && x.p.type === "json"));
  assert.match(t, /R25BK00933736-000 · 변경공고/);
  assert.match(t, /bidPbancNo=R25BK00934017/, "URL 없는 건은 형식 링크 생성");
  assert.match(t, /출처: 조달청 나라장터 입찰공고정보서비스/);
  assert.ok(!/test-key/.test(t), "키 노출 금지");
});

test("검색은 최신 건부터: 마지막 페이지부터 역순, 다 채우면 총건수만 조회", async () => {
  // 250건이 오래된 순(1..250)으로 있는 창. 최신 5건은 250..246이어야 함
  const all = Array.from({ length: 250 }, (_, i) => ({ bidNtceNo: `R26BK${String(i + 1).padStart(8, "0")}`, bidNtceOrd: "000", bidNtceNm: `공고${i + 1}`, bidNtceDt: `2026-10-01 00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}` }));
  const f = makeFetch({
    getBidPblancListInfoServcPPSSrch: (p) => {
      const n = +p.numOfRows, pg = +p.pageNo;
      const items = all.slice((pg - 1) * n, pg * n);
      return JSON.stringify({ response: { header: { resultCode: "00" }, body: { items, totalCount: all.length, numOfRows: n, pageNo: pg } } });
    },
  });
  const c = await connect(ENV, f);
  const t = text(await c.callTool({ name: "g2b_search_bids", arguments: { from: "2026-09-20", to: "2026-10-10", limit: 5 } }));
  const names = [...t.matchAll(/\] (공고\d+)/g)].map((m) => m[1]);
  assert.deepEqual(names, ["공고250", "공고249", "공고248", "공고247", "공고246"]);
  const calls = f.calls.filter((x) => x.op === "getBidPblancListInfoServcPPSSrch");
  // 10월 창: 총건수 1건 + 3페이지 / 9월 창: 총건수 1건만
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((x) => [x.p.numOfRows, x.p.pageNo]), [["1", "1"], ["100", "3"], ["1", "1"]]);
  assert.match(t, /API 집계 500건/);
});

test("bid_detail: 변경 경고·금액·면허 그룹·NODATA 봉투 처리", async () => {
  const c = await connect(ENV, makeFetch());
  const t = text(await c.callTool({ name: "g2b_bid_detail", arguments: { bid_no: `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${NO}&bidPbancOrd=000` } }));
  assert.match(t, /ⓘ 변경공고입니다\. 사유: 공동수급협정서 접수 여부 변경/);
  assert.match(t, /추정가격: 46,363,636원/);
  assert.match(t, /기초금액: 51,000,000원 \(약 5,100만\) \(공개 2025-07-10 09:41:50\)/);
  assert.match(t, /면허제한 그룹 1: 엔지니어링사업자\/1234/);
  assert.match(t, /면허제한 그룹 2: 소프트웨어사업자\/5678 \| 허용업종 기술사사무소 9999|허용업종 기술사사무소\/9999/);
  assert.match(t, /참가가능지역: 충청남도/);
  assert.match(t, /과업지시서\.hwp/);
  assert.ok(!/e발주 첨부: 조회 실패/.test(t), "nkoneps NODATA는 실패가 아님");
  assert.match(t, /판정 아님/);
});

test("bid_detail: 없는 번호는 NOT_FOUND", async () => {
  const c = await connect(ENV, makeFetch());
  const t = text(await c.callTool({ name: "g2b_bid_detail", arguments: { bid_no: "R25BK99999999" } }));
  assert.match(t, /^\[NOT_FOUND\]/);
});

test("bid_changes: 시간순 정렬", async () => {
  const c = await connect(ENV, makeFetch());
  const t = text(await c.callTool({ name: "g2b_bid_changes", arguments: { bid_no: NO, kind: "용역" } }));
  assert.ok(t.indexOf("입찰마감일시") < t.indexOf("공동수급협정서접수방식"));
  assert.match(t, /변경 전: 2025-07-14 10:00/);
});

test("bid_result: 낙찰·사정률(계산)·순위·불일치 표시, 대표자명 미출력, 우리 회사 표시", async () => {
  const c = await connect(ENV, makeFetch());
  const t = text(await c.callTool({ name: "g2b_bid_result", arguments: { bid_no: NO, kind: "용역" } }));
  assert.match(t, /최종낙찰: 주식회사 예신뷰 \(643-87-01544\)/);
  assert.match(t, /사정률 96\.9608% \(계산/);
  assert.match(t, /추첨된 순번 1/);
  assert.match(t, /⚠ 불일치: 최종낙찰금액/);
  assert.ok(t.indexOf("1위 주식회사 예신뷰") < t.indexOf("2위 우리건축"));
  assert.match(t, /2위 우리건축 \(111-11-11111\) ★/);
  assert.match(t, /기술 81\.5 \/ 가격 9\.5894 \/ 종합 91\.0894/);
  assert.ok(!/최인아|02-000-0000/.test(t), "대표자명·전화 미출력");
  assert.ok(!/재입찰 사유/.test(t), "XML NODATA(03)는 결과 없음");
});

test("search_awards: 우리 회사 사업자번호 치환·통계는 (계산)", async () => {
  const f = makeFetch();
  const c = await connect(ENV, f);
  const t = text(await c.callTool({ name: "g2b_search_awards", arguments: { bizno: "우리", from: "2025-07-01", to: "2025-07-20" } }));
  assert.equal(f.calls.find((x) => x.op === "getScsbidListSttusServcPPSSrch").p.bizno, "1111111111");
  assert.match(t, /★ 우리 회사/);
  assert.match(t, /표시된 2건 요약 \(계산\)/);
  assert.match(t, /중앙값 89\.37[78]%/);
});

test("search_prespecs: 연결 공고번호·첨부", async () => {
  const c = await connect(ENV, makeFetch());
  const t = text(await c.callTool({ name: "g2b_search_prespecs", arguments: { keyword: "탄소" } }));
  assert.match(t, /연결된 입찰공고: R25BK00933736/);
  assert.match(t, /첨부 과업지시서\(안\)\.hwp/);
});

test("company_profile: 만료 업종 표시, 대표자·전화 미출력, 제재 없음", async () => {
  const c = await connect(ENV, makeFetch());
  const t = text(await c.callTool({ name: "g2b_company_profile", arguments: {} }));
  assert.match(t, /설정된 우리 회사/);
  assert.match(t, /만료업종\(가상\) \(코드 2222\).*유효기간 지남 \(계산\)/);
  assert.match(t, /\[대표\]/);
  assert.match(t, /이력 없음/);
  assert.ok(!/홍길동|02-111-1111/.test(t));
});

test("check_setup: 미승인(20)·키 오류(30)를 서비스별로 구분", async () => {
  const f = makeFetch({
    getPublicPrcureThngInfoServc: () => JSON.stringify({ response: { header: { resultCode: "20", resultMsg: "SERVICE_ACCESS_DENIED_ERROR" } } }),
    getPrcrmntCorpBasicInfo02: () => ({ status: 401, text: "Unauthorized" }),
  });
  const c = await connect(ENV, f);
  const t = text(await c.callTool({ name: "g2b_check_setup", arguments: {} }));
  assert.match(t, /✓ 조달청 나라장터 입찰공고정보서비스 — 정상/);
  assert.match(t, /✓ 조달청 나라장터 낙찰정보서비스 — 정상/);
  assert.match(t, /✗ 조달청 나라장터 사전규격정보서비스 — 이 서비스에 대한 활용승인이 없습니다/);
  assert.match(t, /✗ 조달청 나라장터 사용자정보서비스 — 인증 실패\(HTTP 401\)/);
});

test("승인 오류는 도구 전체 오류로, 범위 오류(07)는 부분 실패로", async () => {
  const denied = makeFetch({ getBidPblancListInfoServcPPSSrch: () => JSON.stringify({ response: { header: { resultCode: "20", resultMsg: "denied" } } }) });
  let c = await connect(ENV, denied);
  let r = await c.callTool({ name: "g2b_search_bids", arguments: {} });
  assert.equal(r.isError, true);
  assert.match(text(r), /활용승인이 없습니다/);

  let n = 0;
  const partial = makeFetch({
    getBidPblancListInfoServcPPSSrch: () =>
      n++ === 0
        ? JSON.stringify({ "nkoneps.com.response.ResponseError": { header: { resultCode: "07", resultMsg: "입력범위값 초과 에러" } } })
        : JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: [], totalCount: 0 } } }),
  });
  c = await connect(ENV, partial);
  r = await c.callTool({ name: "g2b_search_bids", arguments: { from: "2025-06-15", to: "2025-07-10" } });
  assert.notEqual(r.isError, true);
  assert.match(text(r), /⚠ 일부 구간 조회 실패/);
  assert.match(text(r), /\[NOT_FOUND\]/);
});

test("키 미설정 시 명확한 오류", async () => {
  const c = await connect({}, makeFetch());
  const r = await c.callTool({ name: "g2b_search_bids", arguments: {} });
  assert.match(text(r), /인증키가 설정되지 않았습니다/);
});

test("보조: 월 분할(2월 포함)·날짜·공고번호 파싱·봉투", () => {
  assert.deepEqual(splitMonths("20250115", "20250310").map((w) => w.bgn + "-" + w.end), ["202501150000-202501312359", "202502010000-202502282359", "202503010000-202503102359"]);
  assert.equal(parseDateInput("2026.2.3"), "20260203");
  assert.throws(() => parseDateInput("2026-02-30"));
  assert.deepEqual(parseBidNo("R25BK00933736-1"), { no: "R25BK00933736", ord: "001" });
  assert.deepEqual(parseBidNo("공고 20250712345 확인"), { no: "20250712345", ord: undefined });
  assert.throws(() => parseBidNo("없는번호"));
  assert.deepEqual(parseBody(JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: { item: { a: 1 } }, totalCount: 1 } } })).items, [{ a: 1 }]);
  assert.throws(() => parseBody("<html>gateway</html>"), /해석할 수 없습니다/);
});

test("bid_result: '낙찰하한선미달' 비고 행을 낙찰행으로 오인하지 않고, 낙찰자 순위를 안내(실측 오탐 수정)", async () => {
  const row = (rank, biz, nm, amt, rmrk = "정상") => ({ opengRsltDivNm: "개찰완료", bidNtceNo: NO, bidNtceOrd: "000", bidClsfcNo: "0", rbidNo: "000", opengRank: rank, prcbdrBizno: biz, prcbdrNm: nm, bidprcAmt: amt, bidprcrt: "86.8", rmrk });
  const f = makeFetch({
    getOpengResultListInfoOpengCompt: () => ok([
      row("1", "1208708194", "디앤오", "234140000"),
      row("3", "6438701544", "주식회사 예신뷰", "45000000"),
      row("2", "1308638081", "건보", "234166000"),
      row("48", "9999999999", "하한미달", "231650000", "낙찰하한선미달"),
    ]),
  });
  const c = await connect(ENV, f);
  const t = text(await c.callTool({ name: "g2b_bid_result", arguments: { bid_no: NO, kind: "용역" } }));
  assert.doesNotMatch(t, /⚠ 불일치: 최종낙찰금액/, t);
  assert.match(t, /최종낙찰업체는 개찰순위 3위/);
});

test("g2b_update: 실행 방식별 안내(npx / 실행기 2 / 실행기 3 받음·최신)", async () => {
  const { createServer: cs } = await import("../src/g2b/server.js");
  const call = async (updateInfo) => {
    const server = cs(ENV, { updateInfo });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const cl = new Client({ name: "t", version: "1" });
    await cl.connect(ct);
    return text(await cl.callTool({ name: "g2b_update", arguments: {} }));
  };
  assert.match(await call(null), /npx·개발 실행/);
  const base = { launcherVersion: 2, bundledVersion: "0.0.4", activeVersion: "0.0.4", activeSource: "bundled", autoUpdate: true, repo: "Jaem-Shin/bid-radar" };
  assert.match(await call(base), /수동 업데이트를 지원하지 않습니다/);
  assert.match(await call({ ...base, launcherVersion: 3, checkNow: async () => ({ status: "updated", version: "0.0.8", message: "" }) }), /✓ 0\.0\.8 업데이트를 받았습니다/);
  assert.match(await call({ ...base, launcherVersion: 3, checkNow: async () => ({ status: "latest", message: "최신 버전입니다(0.0.8)" }) }), /최신 버전입니다/);
});
