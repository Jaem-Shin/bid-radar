// data.go.kr 결과코드 → 원인과 조치. 사용자가 그대로 읽고 행동할 수 있는 문장으로.

export class ApiError extends Error {
  constructor(code, message, { kind = "api", httpStatus, retryable = false } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.kind = kind; // api | auth | access | quota | range | network | parse
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

const CODE_INFO = {
  "01": ["api", "조달청 서버 오류(Application Error)입니다. 잠시 후 다시 시도하세요.", true],
  "02": ["api", "조달청 DB 오류입니다. 잠시 후 다시 시도하세요.", true],
  "04": ["api", "조달청 서버 HTTP 오류입니다. 잠시 후 다시 시도하세요.", true],
  "05": ["api", "조달청 서버 응답 시간 초과입니다. 조회 범위를 줄이거나 잠시 후 다시 시도하세요.", true],
  "06": ["range", "날짜 형식 오류입니다.", false],
  "07": ["range", "입력값 범위 초과입니다. 조회 기간이 1개월을 넘었거나 값 범위가 잘못됐습니다.", false],
  "08": ["range", "필수 입력값이 빠졌습니다.", false],
  "10": ["auth", "인증키(ServiceKey)가 전달되지 않았습니다. 설치 설정의 인증키를 확인하세요.", false],
  "11": ["range", "필수 파라미터가 빠졌습니다.", false],
  "12": ["api", "해당 오퍼레이션이 없거나 폐기됐습니다.", false],
  "20": ["access", "이 서비스에 대한 활용승인이 없습니다. 공공데이터포털 마이페이지에서 해당 서비스 활용신청·승인 상태를 확인하세요.", false],
  "22": ["quota", "오늘 호출 한도(일일 트래픽)를 넘었습니다. 내일 다시 시도하거나 포털에서 트래픽 상향을 신청하세요.", false],
  "30": ["auth", "등록되지 않은 인증키입니다. 공공데이터포털의 '일반 인증키(Decoding)'를 그대로 넣었는지 확인하세요.", false],
  "31": ["auth", "기한이 만료된 인증키입니다. 공공데이터포털에서 활용기간을 연장하세요.", false],
  "32": ["auth", "등록되지 않은 IP/도메인입니다.", false],
};

export function errorFromCode(code, msg = "") {
  const info = CODE_INFO[code];
  if (!info) {
    return new ApiError(code, `조달청 API 오류 (결과코드 ${code || "없음"}${msg ? `: ${msg}` : ""})`);
  }
  const [kind, text, retryable] = info;
  return new ApiError(code, `${text} (결과코드 ${code}${msg ? `: ${msg}` : ""})`, { kind, retryable });
}

// 도구 응답용 짧은 표기
export function describeError(e) {
  if (e instanceof ApiError) return e.message;
  return `처리 중 오류: ${e?.message || e}`;
}

export function isAccessError(e) {
  return e instanceof ApiError && (e.kind === "access" || e.kind === "auth");
}
