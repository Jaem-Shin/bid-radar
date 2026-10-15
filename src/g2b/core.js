// G2B 업데이트 단위 모듈(core.mjs). 불러오기만으로는 아무것도 실행하지 않는다 — 실행기가 start/probe를 부른다.
import { createServer, VERSION } from "./server.js";
import { makeCore } from "../common/core.js";

export { VERSION };
export const { start, probe } = makeCore(createServer, VERSION);
