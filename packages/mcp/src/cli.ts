/**
 * `npx @a11ychk/mcp`가 실행하는 진입점. Node.js 버전을 확인한 뒤 서버 본체(server.ts)를 불러온다.
 *
 * 이 파일에서는 의존성을 정적으로 import하지 않는다. ESM은 본문보다 import를 먼저 평가하므로,
 * 서버 본체를 정적으로 import하면 낮은 Node에서는 아래 확인보다 의존성(undici)의 TypeError가
 * 먼저 난다. 그래서 본체는 확인이 끝난 뒤 동적 import로 불러오고, 빌드도 dist/cli.mjs와
 * dist/server.mjs 두 파일로 나눈다. 이 조건은 스모크(scripts/smoke.mjs)가 확인한다.
 */
import { unsupportedNodeMessage } from "./nodeVersion";

const problem = unsupportedNodeMessage(process.versions.node);
if (problem) {
  // stdout은 JSON-RPC 채널이라 안내는 stderr로 낸다. process.exit()는 파이프에 쓰던 출력을
  // 자를 수 있어서, 종료 코드만 정해 두고 프로세스가 스스로 끝나게 둔다.
  process.stderr.write(`${problem}\n`);
  process.exitCode = 1;
} else {
  void import("./server");
}
