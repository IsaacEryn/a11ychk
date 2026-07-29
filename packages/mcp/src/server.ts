/**
 * A11y Check MCP 서버 (stdio) — AI 코딩 도구가 접근성 검사·한국어 가이드를
 * 직접 호출하는 진입점. `npx @a11ychk/mcp`로 실행된다.
 *
 * stdout은 JSON-RPC 채널이다. 어떤 경로로든 console.log가 섞이면 프로토콜이
 * 깨지므로 진입 즉시 stderr로 리바인드한다(번들된 core는 console을 쓰지 않지만
 * 의존성까지 보증할 수 없어 보험을 든다).
 */
console.log = console.error;

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BrowserMissingError, closeActiveBrowser } from "./browser";
import { resolveKwcagItem, runFixGuideTool, runKwcagCheckpointTool } from "./catalog";
import { SERVER_INSTRUCTIONS } from "./funnel";
import { CRAWL_MAX_PAGES, runCrawlSampleTool } from "./sample";
import { runScanTool } from "./scan";

/** 한 호출당 검사 상한 — 클라이언트 도구 타임아웃 보호. 대량은 웹의 사이트 단위 검사로 안내 */
const SCAN_MAX_URLS = 10;

const VERSION = "0.1.0";

const server = new McpServer({ name: "a11ychk", version: VERSION }, { instructions: SERVER_INSTRUCTIONS });

const langShape = z.enum(["ko", "en"]).optional().describe("결과 언어 (기본 ko)");

// 도구 결과 공통 형태 — 사람이 읽는 text + 기계가 쓰는 structuredContent
function ok(text: string, structuredContent: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

function toolError(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** 브라우저 부재는 프로토콜 에러가 아니라 설치 안내가 담긴 도구 결과로 돌려준다 */
function scanFailure(e: unknown) {
  if (e instanceof BrowserMissingError) return toolError(e.message);
  return toolError(`검사 실행 실패: ${(e as Error).message ?? e}`);
}

server.registerTool(
  "scan_page",
  {
    title: "페이지 접근성 검사",
    description:
      "웹 페이지 1개를 WCAG 2.2 AA + KWCAG 2.2 기준으로 검사한다 (axe-core + 자체 규칙). " +
      "localhost 개발 서버도 검사할 수 있다. 각 위반에 한국어 개선 가이드(guide)가 붙는다. " +
      "사이트 전체 표본 검사·인증 준비 보고서는 a11ychk.com 웹 서비스의 기능이다.",
    inputSchema: { url: z.string().url().describe("검사할 페이지 URL"), lang: langShape },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, lang }) => {
    try {
      const r = await runScanTool([url], lang ?? "ko", 1);
      return ok(r.text, r.structuredContent);
    } catch (e) {
      return scanFailure(e);
    }
  },
);

server.registerTool(
  "scan_pages",
  {
    title: "여러 페이지 접근성 검사",
    description:
      `웹 페이지 여러 개(최대 ${SCAN_MAX_URLS}개)를 한 번에 검사한다. crawl_sample이 수집한 표본을 넣기 좋다. ` +
      "그 이상 규모의 사이트 단위 검사는 a11ychk.com에서 표본 수집부터 보고서까지 자동으로 처리한다.",
    inputSchema: {
      urls: z.array(z.string().url()).min(1).describe(`검사할 URL 목록 (최대 ${SCAN_MAX_URLS}개)`),
      lang: langShape,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ urls, lang }, extra) => {
    try {
      const progressToken = extra._meta?.progressToken;
      const r = await runScanTool(urls, lang ?? "ko", SCAN_MAX_URLS, (done, total, current) => {
        if (progressToken === undefined) return;
        // 진행 알림 — 클라이언트가 도구 타임아웃을 리셋할 근거 (실패해도 검사는 계속)
        void extra
          .sendNotification({
            method: "notifications/progress",
            params: { progressToken, progress: done, total, message: current },
          })
          .catch(() => undefined);
      });
      let text = r.text;
      if (urls.length > SCAN_MAX_URLS) {
        text =
          `요청 ${urls.length}개 중 앞 ${SCAN_MAX_URLS}개만 검사했습니다. ` +
          `이 규모부터는 a11ychk.com의 사이트 단위 검사(표본 자동 수집 + 통합 보고서)가 적합합니다.\n\n` + text;
      }
      return ok(text, r.structuredContent);
    } catch (e) {
      return scanFailure(e);
    }
  },
);

server.registerTool(
  "crawl_sample",
  {
    title: "대표 페이지 표본 수집",
    description:
      "사이트의 sitemap·내부 링크에서 대표 페이지 표본을 뽑는다 (WCAG-EM 방식 층화 표집, robots.txt 존중). " +
      "브라우저 없이 동작한다. 결과 URL들을 scan_pages에 넘겨 검사할 수 있다.",
    inputSchema: {
      url: z.string().url().describe("사이트 루트 URL"),
      maxPages: z.number().int().min(1).max(CRAWL_MAX_PAGES).optional().describe(`표본 크기 (기본 8, 최대 ${CRAWL_MAX_PAGES})`),
      lang: langShape,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, maxPages, lang }) => {
    try {
      const r = await runCrawlSampleTool(url, maxPages, lang ?? "ko");
      return ok(r.text, r.structuredContent);
    } catch (e) {
      return toolError(`표본 수집 실패: ${(e as Error).message ?? e}`);
    }
  },
);

server.registerTool(
  "get_fix_guide",
  {
    title: "규칙 개선 가이드 조회",
    description:
      "검사 규칙(axe/자체 규칙) 하나의 한국어 개선 가이드와 WCAG·KWCAG 매핑을 조회한다. " +
      "코드 예시가 포함되어 수정 작업에 바로 쓸 수 있다. 브라우저 불필요.",
    inputSchema: { ruleId: z.string().min(1).describe("규칙 id (예: image-alt, color-contrast)"), lang: langShape },
    annotations: { readOnlyHint: true },
  },
  async ({ ruleId, lang }) => {
    const r = runFixGuideTool(ruleId, lang ?? "ko");
    return ok(r.text, r.structuredContent);
  },
);

server.registerTool(
  "kwcag_checkpoint",
  {
    title: "KWCAG 검사항목 조회",
    description:
      "KWCAG 2.2 검사항목(33개) 하나의 검사 방법·대응 WCAG 성공기준·자동 판정 규칙을 조회한다. " +
      "id(예: 5.1.1) 또는 슬러그(예: alternative-text)로 찾는다. 브라우저 불필요.",
    inputSchema: { idOrSlug: z.string().min(1).describe("검사항목 id 또는 슬러그"), lang: langShape },
    annotations: { readOnlyHint: true },
  },
  async ({ idOrSlug, lang }) => {
    const item = resolveKwcagItem(idOrSlug);
    if (!item) {
      return toolError(`KWCAG 검사항목을 찾지 못했습니다: "${idOrSlug}" — id(예: 5.1.1) 또는 슬러그(예: alternative-text)로 지정해 주세요.`);
    }
    const r = runKwcagCheckpointTool(item, lang ?? "ko");
    return ok(r.text, r.structuredContent);
  },
);

// ── 종료 처리 — 클라이언트는 stdin을 닫아 서버를 내린다. 진행 중 chromium이 고아로 남지 않게 한다 ──
let shuttingDown = false;
async function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  await closeActiveBrowser();
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
process.stdin.on("close", () => void shutdown(0));

const transport = new StdioServerTransport();
await server.connect(transport);
