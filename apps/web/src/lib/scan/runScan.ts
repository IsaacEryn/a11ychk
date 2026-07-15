import "server-only";
import net from "node:net";
import type { Browser } from "playwright-core";
import {
  AXE_VERSION,
  aggregateScan,
  assertPublicHttpUrl,
  buildSample,
  categorizePage,
  detectTechnologies,
  guardedFetch,
  isPrivateAddress,
  normalizeUrl,
  runAxeOnPage,
  type EvaluationScope,
  type PageScanResult,
  type SampleResult,
  type SampleSummary,
  type WcagLevel,
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

  const scope = (scan.scope ?? null) as EvaluationScope | null;
  const conformanceTarget: WcagLevel | "AAA" = scope?.conformanceTarget ?? "AA";

  let browser: Browser | null = null;
  try {
    // 1) WCAG-EM Step 2·3 — 표본 구성
    //    점검자가 직접 페이지를 지정했으면 그 목록을, 아니면 자동 수집(buildSample)
    let sample: SampleResult;
    if (scope?.manualPages && scope.manualPages.length > 0) {
      let technologies = ["HTML"];
      try {
        const res = await guardedFetch(scan.root_url);
        if (res.ok) technologies = detectTechnologies((await res.text()).slice(0, 3_000_000));
      } catch {
        // 기술 감지 실패해도 검사는 진행
      }
      const rootNorm = normalizeUrl(scan.root_url);
      sample = {
        pages: scope.manualPages.map((u) => ({
          url: u,
          category: categorizePage(u, u === rootNorm),
          sampleType: "structured" as const,
        })),
        technologies,
        sampleMethod: `점검자 직접 입력 표본 ${scope.manualPages.length}개 (WCAG-EM 3.a 구조 표본)`,
        source: "root-only",
      };
    } else {
      sample = await buildSample(scan.root_url, {
        maxPages: scan.page_limit,
        fetcher: (u) => guardedFetch(u),
      });
    }

    // 2) 페이지 행 생성 (표본 유형·분류 기록)
    const { data: pageRows, error: insertError } = await db
      .from("scan_pages")
      .insert(
        sample.pages.map((p) => ({
          scan_id: scanId,
          url: p.url,
          status: "pending",
          category: p.category,
          sample_type: p.sampleType,
        })),
      )
      .select("id, url, sample_type");
    if (insertError || !pageRows) throw new Error(`페이지 행 생성 실패: ${insertError?.message}`);

    // 3) 페이지별 스캔 (부분 실패 허용) — 구조/무작위 표본별 위반 규칙 추적(WCAG-EM 4.c)
    browser = await launchGuardedBrowser();
    const results: PageScanResult[] = [];
    const structuredRules = new Set<string>();
    const randomRules = new Set<string>();

    for (const row of pageRows) {
      await db.from("scan_pages").update({ status: "running" }).eq("id", row.id);
      try {
        // 페이지 이동 직전 재검증 (수집 시점과 DNS가 달라졌을 수 있음)
        await assertPublicHttpUrl(row.url);

        // 앞선 페이지에서 chromium이 크래시(OOM 등)했다면 재실행 —
        // 한 페이지 실패가 이후 모든 페이지로 번지는 것을 방지한다.
        if (!browser.isConnected()) {
          browser = await launchGuardedBrowser();
        }

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

          // 표본 유형별 위반 규칙 집계 (WCAG-EM 4.c 대표성 비교)
          const ruleTarget = row.sample_type === "random" ? randomRules : structuredRules;
          for (const v of result.violations) ruleTarget.add(v.ruleId);

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
      throw new Error(
        "모든 페이지 스캔에 실패했습니다. '봇 차단 검증' 메뉴에서 사이트가 봇을 차단하는지 진단해 보세요. 차단된 사이트는 크롬 확장으로 검사할 수 있습니다.",
      );
    }

    // 4) 집계 → 완료 (WCAG-EM 표본 요약 + 목표 수준 반영)
    const randomSurfacedNewRules = [...randomRules].filter((r) => !structuredRules.has(r));
    const sampleSummary: SampleSummary = {
      structuredCount: sample.pages.filter((p) => p.sampleType === "structured").length,
      randomCount: sample.pages.filter((p) => p.sampleType === "random").length,
      processCount: 0,
      method: sample.sampleMethod,
      technologies: sample.technologies,
      randomSurfacedNewRules,
    };
    const summary = aggregateScan(results, AXE_VERSION, {
      conformanceTarget,
      sample: sampleSummary,
      plannedPageCount: sample.pages.length,
    });
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
