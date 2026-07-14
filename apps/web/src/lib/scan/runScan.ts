import "server-only";
import net from "node:net";
import type { Browser } from "playwright-core";
import {
  AXE_VERSION,
  aggregateScan,
  assertPublicHttpUrl,
  collectPages,
  guardedFetch,
  isPrivateAddress,
  runAxeOnPage,
  type PageScanResult,
} from "@a11ychk/core";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_LOAD_TIMEOUT_MS = 20_000;

/** 서브리소스 요청 중 명백한 내부망 접근 차단 (SSRF 심층 방어) */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  return net.isIP(host) !== 0 && isPrivateAddress(host);
}

/**
 * 스캔 오케스트레이터.
 * POST /api/scans에서 after()로 호출된다 — 사용자 응답 이후 백그라운드 실행.
 * 실패해도 throw하지 않고 scans.status='failed'로 기록한다.
 */
export async function runScan(scanId: string): Promise<void> {
  const db = createAdminClient();

  const { data: scan, error: loadError } = await db.from("scans").select("*").eq("id", scanId).single();
  if (loadError || !scan || scan.status !== "queued") return;

  await db.from("scans").update({ status: "running", started_at: new Date().toISOString() }).eq("id", scanId);

  let browser: Browser | null = null;
  try {
    // 1) 대표 페이지 수집 (robots.txt 존중, SSRF 가드 fetch)
    const crawl = await collectPages(scan.root_url, {
      maxPages: scan.page_limit,
      fetcher: (u) => guardedFetch(u),
    });

    // 2) 페이지 행 생성
    const { data: pageRows, error: insertError } = await db
      .from("scan_pages")
      .insert(crawl.urls.map((url) => ({ scan_id: scanId, url, status: "pending" })))
      .select("id, url");
    if (insertError || !pageRows) throw new Error(`페이지 행 생성 실패: ${insertError?.message}`);

    // 3) 페이지별 스캔 (부분 실패 허용)
    browser = await launchGuardedBrowser();
    const results: PageScanResult[] = [];

    for (const row of pageRows) {
      await db.from("scan_pages").update({ status: "running" }).eq("id", row.id);
      try {
        // 페이지 이동 직전 재검증 (수집 시점과 DNS가 달라졌을 수 있음)
        await assertPublicHttpUrl(row.url);

        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          locale: "ko-KR",
          userAgent: "Mozilla/5.0 (compatible; a11ychk-bot/0.1; +https://a11ychk.com/bot)",
        });
        try {
          const page = await context.newPage();
          // 서브리소스의 내부망 접근 차단
          await page.route("**/*", (route) => {
            const host = new URL(route.request().url()).hostname;
            if (isBlockedHost(host)) return route.abort();
            return route.continue();
          });
          await page.goto(row.url, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_TIMEOUT_MS });
          await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => undefined);

          const result = await runAxeOnPage(page);
          results.push(result);

          // findings 저장
          if (result.violations.length > 0) {
            const findingRows = result.violations.flatMap((v) =>
              v.nodes.map((n) => ({
                scan_page_id: row.id,
                rule_id: v.ruleId,
                impact: v.impact,
                tags: v.tags,
                help_url: v.helpUrl,
                selector: n.selector,
                html_snippet: n.html,
                failure_summary: n.failureSummary,
              })),
            );
            const { error: fErr } = await db.from("findings").insert(findingRows);
            if (fErr) throw new Error(`위반 저장 실패: ${fErr.message}`);
          }

          const counts: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
          for (const v of result.violations) counts[v.impact] = (counts[v.impact] ?? 0) + v.nodes.length;
          await db
            .from("scan_pages")
            .update({
              status: "done",
              violation_counts: counts,
              passes: result.passes,
              incomplete: result.incomplete,
              scanned_at: result.scannedAt,
            })
            .eq("id", row.id);
        } finally {
          await context.close();
        }
      } catch (pageError) {
        await db
          .from("scan_pages")
          .update({ status: "failed", error: truncate((pageError as Error).message, 500) })
          .eq("id", row.id);
      }
    }

    if (results.length === 0) {
      throw new Error("모든 페이지 스캔에 실패했습니다. 사이트가 봇 접근을 차단하는지 확인해 주세요.");
    }

    // 4) 집계 → 완료
    const summary = aggregateScan(results, AXE_VERSION);
    await db
      .from("scans")
      .update({ status: "done", summary, finished_at: new Date().toISOString() })
      .eq("id", scanId);
  } catch (error) {
    await db
      .from("scans")
      .update({
        status: "failed",
        error: truncate((error as Error).message, 500),
        finished_at: new Date().toISOString(),
      })
      .eq("id", scanId);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function launchGuardedBrowser(): Promise<Browser> {
  const { launchBrowser } = await import("./browser");
  return launchBrowser();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
