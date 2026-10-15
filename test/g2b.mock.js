// 명세서 예제값 기반 모의 응답. URL의 오퍼레이션명·파라미터로 라우팅.
export const NO = "R25BK00933736";

export const ok = (items, total = items.length) =>
  JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "정상" }, body: { items, numOfRows: 100, pageNo: 1, totalCount: total } } });
const empty = () => JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "정상" }, body: { items: "", numOfRows: 100, pageNo: 1, totalCount: 0 } } });

export const notice = {
  bidNtceNo: NO, bidNtceOrd: "000", reNtceYn: "N", ntceKindNm: "변경공고", chgNtceRsn: "공동수급협정서 접수 여부 변경",
  bidNtceDt: "2025-07-01 09:28:14", bidNtceNm: "AI 기반 탄소 데이터 정제 알고리즘 개발 용역",
  ntceInsttNm: "한국생산기술연구원", dminsttNm: "한국생산기술연구원", bidMethdNm: "전자입찰", cntrctCnclsMthdNm: "제한경쟁",
  ntceInsttOfclNm: "권세운", ntceInsttOfclTelNo: "041-589-8532", bidQlfctRgstDt: "2025-07-14 18:00",
  bidBeginDt: "2025-07-02 09:00:00", bidClseDt: "2025-07-15 10:00:00", opengDt: "2025-07-15 11:00:00",
  ntceSpecDocUrl1: "https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadFile.do?bidPbancNo=R25BK00933736&bidPbancOrd=000&fileType=&fileSeq=1&prcmBsneSeCd=03",
  ntceSpecFileNm1: "과업지시서.hwp", ntceSpecFileNm2: "공고서.pdf",
  ntceSpecDocUrl2: "https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadFile.do?bidPbancNo=R25BK00933736&bidPbancOrd=000&fileType=&fileSeq=2&prcmBsneSeCd=03",
  prearngPrceDcsnMthdNm: "복수예가", totPrdprcNum: "15", drwtPrdprcNum: "4", asignBdgtAmt: "51000000", presmptPrce: "46363636",
  opengPlce: "우리 원 구매자산실 입찰집행관 PC",
  bidNtceDtlUrl: " https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R25BK00933736&bidPbancOrd=000",
  srvceDivNm: "일반용역", cmmnSpldmdMethdNm: "(없음)공동수급불허", bfSpecRgstNo: "R25BD00084695", orderPlanUntyNo: "R25DD20312981",
  sucsfbidMthdNm: "협상에의한계약", indstrytyLmtYn: "N", VAT: "4636364", techAbltEvlRt: "80", bidPrceEvlRt: "20",
  pubPrcrmntLrgClsfcNm: "ICT 서비스", pubPrcrmntMidClsfcNm: "DB구축 및 자료입력", jntcontrctDutyRgnNm1: "", rgnDutyJntcontrctRt: "",
};

export function makeFetch(overrides = {}) {
  const calls = [];
  const f = async (url) => {
    const u = new URL(url);
    const op = u.pathname.split("/").pop();
    const p = Object.fromEntries(u.searchParams);
    calls.push({ op, p, url });
    const body = overrides[op] ? overrides[op](p) : route(op, p);
    const status = typeof body === "object" && body.status ? body.status : 200;
    const text = typeof body === "object" && body.text !== undefined ? body.text : body;
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  f.calls = calls;
  return f;
}

function route(op, p) {
  switch (op) {
    // ── 입찰공고
    case "getBidPblancListInfoServcPPSSrch":
      return ok([
        { ...notice },
        { ...notice, bidNtceNo: "R25BK00934017", bidNtceNm: "남부 관내 건설폐기물 처리용역", ntceKindNm: "등록공고", bidNtceDt: "2025-07-01 13:21:14", presmptPrce: "129834000", bidNtceDtlUrl: "" },
      ]);
    case "getBidPblancListInfoServc":
      if (p.inqryDiv === "2" && p.bidNtceNo === NO) return ok([{ ...notice }]);
      return ok([], 0);
    case "getBidPblancListInfoCnstwk":
    case "getBidPblancListInfoThng":
    case "getBidPblancListInfoFrgcpt":
      return empty();
    case "getBidPblancListInfoServcBsisAmount":
      return ok([{ bidNtceNo: NO, bidNtceOrd: "000", bidNtceNm: notice.bidNtceNm, bssamt: "51000000", bssamtOpenDt: "2025-07-10 09:41:50", rsrvtnPrceRngBgnRate: "-3", rsrvtnPrceRngEndRate: "+3", rmrk1: "기초금액은 부가세 포함 가격임." }]);
    case "getBidPblancListInfoLicenseLimit":
      return ok([
        { bidNtceNo: NO, bidNtceOrd: "000", lmtGrpNo: "1", lmtSno: "1", lcnsLmtNm: "엔지니어링사업자/1234", permsnIndstrytyList: "" },
        { bidNtceNo: NO, bidNtceOrd: "000", lmtGrpNo: "2", lmtSno: "1", lcnsLmtNm: "소프트웨어사업자/5678", permsnIndstrytyList: "[기술사사무소/9999]" },
      ]);
    case "getBidPblancListInfoPrtcptPsblRgn":
      return ok([{ bidNtceNo: NO, bidNtceOrd: "000", lmtSno: "1", prtcptPsblRgnNm: "충청남도" }]);
    case "getBidPblancListInfoEorderAtchFileInfo":
      return JSON.stringify({ "nkoneps.com.response.ResponseError": { header: { resultCode: "03", resultMsg: "NODATA_ERROR" } } });
    case "getBidPblancListInfoChgHstryServc":
      return ok([
        { bsnsDivNm: "용역", chgDataDivNm: "공고", chgDt: "2025-07-03 10:00:00", bidNtceNo: NO, bidNtceOrd: "000", rbidNo: "000", chgItemNm: "공동수급협정서접수방식", bfchgVal: "전자", afchgVal: "없음" },
        { bsnsDivNm: "용역", chgDataDivNm: "공고", chgDt: "2025-07-02 09:00:00", bidNtceNo: NO, bidNtceOrd: "000", rbidNo: "000", chgItemNm: "입찰마감일시", bfchgVal: "2025-07-14 10:00", afchgVal: "2025-07-15 10:00" },
      ]);
    // ── 낙찰
    case "getScsbidListSttusServc":
      if (p.inqryDiv === "4") return ok([{ bidNtceNo: NO, bidNtceOrd: "000", bidClsfcNo: "0", rbidNo: "000", bidNtceNm: notice.bidNtceNm, prtcptCnum: "3", bidwinnrNm: "주식회사 예신뷰", bidwinnrBizno: "6438701544", bidwinnrCeoNm: "최인아", bidwinnrTelNo: "02-000-0000", sucsfbidAmt: "45000000", sucsfbidRate: "91.01", rlOpengDt: "2025-07-15 11:05:00", fnlSucsfDate: "2025-07-20" }]);
      return ok([], 0);
    case "getOpengResultListInfoServc":
      return ok([{ bidNtceNo: NO, bidNtceOrd: "000", bidClsfcNo: "0", rbidNo: "000", bidNtceNm: notice.bidNtceNm, opengDt: "2025-07-15 11:00:00", prtcptCnum: "3", opengCorpInfo: "주식회사 예신뷰^6438701544^최인아^45000000^91.01", progrsDivCdNm: "개찰완료" }]);
    case "getOpengResultListInfoServcPreparPcDetail":
      return ok([
        { bidNtceNo: NO, bidNtceOrd: "000", bidClsfcNo: "0", rbidNo: "000", plnprc: "49450000", bssamt: "51000000", compnoRsrvtnPrceSno: "1", drwtYn: "Y" },
        { bidNtceNo: NO, bidNtceOrd: "000", bidClsfcNo: "0", rbidNo: "000", plnprc: "49450000", bssamt: "51000000", compnoRsrvtnPrceSno: "2", drwtYn: "N" },
      ]);
    case "getOpengResultListInfoOpengCompt":
      return ok([
        { opengRsltDivNm: "개찰완료", bidNtceNo: NO, bidNtceOrd: "000", bidClsfcNo: "0", rbidNo: "000", opengRank: "2", prcbdrBizno: "1111111111", prcbdrNm: "우리건축", bidprcAmt: "46000000", bidprcrt: "93.02", techEvlVal: "79", bidPrceEvlVal: "9.1", totalEvlAmtVal: "88.1" },
        { opengRsltDivNm: "개찰완료", bidNtceNo: NO, bidNtceOrd: "000", bidClsfcNo: "0", rbidNo: "000", opengRank: "1", prcbdrBizno: "6438701544", prcbdrNm: "주식회사 예신뷰", prcbdrCeoNm: "최인아", bidprcAmt: "45100000", bidprcrt: "91.20", rmrk: "낙찰", techEvlVal: "81.5", bidPrceEvlVal: "9.5894", totalEvlAmtVal: "91.0894" },
        { opengRsltDivNm: "개찰완료", bidNtceNo: NO, bidNtceOrd: "000", bidClsfcNo: "0", rbidNo: "000", opengRank: "3", prcbdrBizno: "2222222222", prcbdrNm: "다른엔지니어링", bidprcAmt: "47000000", bidprcrt: "95.04" },
      ]);
    case "getOpengResultListInfoFailing":
      return empty();
    case "getOpengResultListInfoRebid":
      return "<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>NODATA_ERROR</returnAuthMsg><returnReasonCode>03</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>";
    case "getScsbidListSttusServcPPSSrch":
      return ok([
        { bidNtceNo: NO, bidNtceOrd: "000", bidNtceNm: notice.bidNtceNm, prtcptCnum: "3", bidwinnrNm: "주식회사 예신뷰", bidwinnrBizno: "6438701544", sucsfbidAmt: "45000000", sucsfbidRate: "91.01", rlOpengDt: "2025-07-15 11:05:00", dminsttNm: "한국생산기술연구원" },
        { bidNtceNo: "R25BK00000002", bidNtceOrd: "000", bidNtceNm: "OO부대 시설 설계용역", prtcptCnum: "12", bidwinnrNm: "우리건축", bidwinnrBizno: "1111111111", sucsfbidAmt: "300000000", sucsfbidRate: "87.745", rlOpengDt: "2025-07-10 11:00:00", dminsttNm: "국방시설본부" },
      ]);
    // ── 사전규격
    case "getPublicPrcureThngInfoServcPPSSrch":
      return ok([{ bfSpecRgstNo: "R25BD00084695", prdctClsfcNoNm: "AI 기반 탄소 데이터 정제 알고리즘 개발 용역", asignBdgtAmt: "51000000", orderInsttNm: "한국생산기술연구원", rlDminsttNm: "한국생산기술연구원", rgstDt: "2025-06-20 10:00:00", opninRgstClseDt: "2025-06-27 18:00:00", bidNtceNoList: NO, specDocFileNm1: "과업지시서(안).hwp", specDocFileUrl1: "https://www.g2b.go.kr/x?f=1" }]);
    case "getPublicPrcureThngInfoServc":
      return ok([], 0);
    // ── 사용자정보
    case "getPrcrmntCorpBasicInfo02":
      return ok([{ bizno: p.bizno, corpNm: "우리건축", rgnNm: "서울특별시", adrs: "서울특별시 서대문구", ceoNm: "홍길동", telNo: "02-111-1111", rgstDt: "2010-01-01", hdoffceDivNm: "본사" }]);
    case "getPrcrmntCorpIndstrytyInfo02":
      return ok([
        { bizno: p.bizno, indstrytyCd: "1111", indstrytyNm: "건축사사무소업(가상)", indstrytyStatsNm: "정상", vldPrdExprtDt: "2099-12-31", rprsntIndstrytyYn: "Y" },
        { bizno: p.bizno, indstrytyCd: "2222", indstrytyNm: "만료업종(가상)", indstrytyStatsNm: "정상", vldPrdExprtDt: "2020-01-01" },
      ]);
    case "getUnptRsttCorpInfo02":
      return empty();
    default:
      return JSON.stringify({ response: { header: { resultCode: "12", resultMsg: "NO_OPENAPI_SERVICE_ERROR" } } });
  }
}
