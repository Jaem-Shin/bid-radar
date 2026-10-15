// 제품 공통 start/probe — 실행기가 부르는 두 함수.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

export function makeCore(createServer, version) {
  async function start({ updateInfo } = {}) {
    const server = createServer(process.env, { updateInfo });
    await server.connect(new StdioServerTransport());
    return server;
  }
  // 시험 로드: API 호출 없이 서버를 띄워 도구 목록 수를 돌려준다.
  async function probe() {
    const server = createServer({ DATA_GO_KR_SERVICE_KEY: "" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "probe", version });
    await client.connect(ct);
    const { tools } = await client.listTools();
    await client.close();
    await server.close();
    return tools.length;
  }
  return { start, probe };
}
