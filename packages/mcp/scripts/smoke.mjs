/**
 * MCP 서버 스모크 — 클라이언트 라이브러리 없이 stdio로 JSON-RPC를 직접 주고받는다.
 *
 * 서버의 stdout 모든 줄을 JSON.parse로 강제한다. 파싱에 실패하는 줄이 하나라도
 * 있으면 stdout이 로그로 오염된 것이고, 그 자체가 프로토콜 위반이므로 실패시킨다.
 *
 * 사용법:
 *   node scripts/smoke.mjs                  # 브라우저 불필요 검사만 (카탈로그 도구)
 *   node scripts/smoke.mjs --scan <url>     # scan_page 통합 검사 (chromium 필요)
 *   node scripts/smoke.mjs --crawl <url>    # crawl_sample 검사 (픽스처 서버 필요)
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.mjs");
const scanUrl = process.argv.includes("--scan") ? process.argv[process.argv.indexOf("--scan") + 1] : null;
const crawlUrl = process.argv.includes("--crawl") ? process.argv[process.argv.indexOf("--crawl") + 1] : null;

const child = spawn(process.execPath, [cliPath], { stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map(); // id → {resolve, reject}
let nextId = 1;

const rl = createInterface({ input: child.stdout });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    console.error(`stdout 오염 감지 — JSON이 아닌 출력: ${line.slice(0, 200)}`);
    process.exit(1);
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(`RPC 오류: ${JSON.stringify(msg.error)}`));
    else resolve(msg.result);
  }
  // notifications(progress 등)는 무시 — 수신 자체가 JSON이면 충분
});

function request(method, params, timeoutMs = 120_000) {
  const id = nextId++;
  const p = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} ${timeoutMs}ms 타임아웃`));
    }, timeoutMs).unref();
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return p;
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

function assert(cond, label) {
  if (!cond) {
    console.error(`실패: ${label}`);
    process.exitCode = 1;
    throw new Error(label);
  }
  console.error(`  ok  ${label}`);
}

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "a11ychk-smoke", version: "0.0.0" },
  });
  assert(init.serverInfo?.name === "a11ychk", "initialize: serverInfo.name");
  assert(typeof init.instructions === "string" && init.instructions.includes("a11ychk.com"), "initialize: 퍼널 instructions 포함");
  notify("notifications/initialized", {});

  const tools = await request("tools/list", {});
  const names = tools.tools.map((t) => t.name).sort();
  assert(
    JSON.stringify(names) === JSON.stringify(["crawl_sample", "get_fix_guide", "kwcag_checkpoint", "scan_page", "scan_pages"]),
    `tools/list: 도구 5종 (${names.join(", ")})`,
  );

  const guide = await request("tools/call", { name: "get_fix_guide", arguments: { ruleId: "image-alt" } });
  assert(guide.isError !== true, "get_fix_guide: 성공");
  assert(guide.structuredContent?.known === true, "get_fix_guide: 카탈로그 등재 규칙");
  assert(guide.structuredContent?.kwcag?.includes("5.1.1"), "get_fix_guide: KWCAG 매핑");
  assert(guide.structuredContent?.guide?.length > 50, "get_fix_guide: 한국어 가이드 본문");

  const cp = await request("tools/call", { name: "kwcag_checkpoint", arguments: { idOrSlug: "alternative-text" } });
  assert(cp.isError !== true, "kwcag_checkpoint: 슬러그 해석");
  assert(cp.structuredContent?.id === "5.1.1", "kwcag_checkpoint: id 일치");
  assert(cp.structuredContent?.automatedRules?.length > 0, "kwcag_checkpoint: 자동 판정 규칙 역매핑");
  assert(cp.content?.[0]?.text?.includes("a11ychk.com"), "kwcag_checkpoint: 결과 말미 서비스 안내");

  const missing = await request("tools/call", { name: "kwcag_checkpoint", arguments: { idOrSlug: "no-such" } });
  assert(missing.isError === true, "kwcag_checkpoint: 미존재 항목은 isError 결과");

  if (crawlUrl) {
    const crawl = await request("tools/call", { name: "crawl_sample", arguments: { url: crawlUrl, maxPages: 5 } });
    assert(crawl.isError !== true, "crawl_sample: 성공");
    assert(crawl.structuredContent?.pages?.length >= 1, "crawl_sample: 표본 1개 이상");
  }

  if (scanUrl) {
    const scan = await request("tools/call", { name: "scan_page", arguments: { url: scanUrl } }, 300_000);
    assert(scan.isError !== true, "scan_page: 성공");
    const sc = scan.structuredContent;
    assert(sc?.scannedPages === 1, "scan_page: 1페이지 검사");
    assert(typeof sc?.complianceRate === "number", "scan_page: 준수율 숫자");
    assert(scan.content?.[0]?.text?.includes("a11ychk.com"), "scan_page: 결과 말미 서비스 안내");
    // 픽스처 위반 페이지면 위반이 있어야 하고, guide가 붙어 있어야 한다
    if (scanUrl.includes("violations")) {
      assert(sc.violationRules > 0, "scan_page: 위반 검출");
      assert(sc.violations[0]?.guide?.length > 20, "scan_page: 위반에 개선 가이드 동봉");
      assert(sc.advisoryRules >= 0 && Array.isArray(sc.advisory), "scan_page: 권고 분리 필드");
    }
    if (scanUrl.includes("clean")) {
      assert(sc.violationRules === 0, "scan_page: 정상 페이지 위반 0");
    }
  }

  child.stdin.end();
  await new Promise((r) => child.on("exit", r));
  assert(child.exitCode === 0, `정상 종료 (exit=${child.exitCode})`);
  console.error("\n스모크 통과");
} catch (e) {
  console.error(String(e?.message ?? e));
  child.kill();
  process.exit(1);
}
