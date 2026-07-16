import "server-only";
import net from "node:net";
import type { Browser } from "playwright-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AXE_VERSION,
  aggregateScan,
  assertPublicHttpUrl,
  buildSample,
  categorizePage,
  computeNotPresentScs,
  computeSiteChecks,
  detectTechnologies,
  extractPageSignature,
  guardedFetch,
  isPrivateAddress,
  normalizeUrl,
  runAxeOnPage,
  type EvaluationScope,
  type Finding,
  type Impact,
  type PageScanResult,
  type PageSignature,
  type SampleResult,
  type SampleSummary,
  type WcagLevel,
  type WcagOutcome,
} from "@a11ychk/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/scan/fetchAll";

const PAGE_LOAD_TIMEOUT_MS = 20_000;

/** 서브리소스 요청 중 명백한 내부망 접근 차단 (SSRF 심층 방어) */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  return net.isIP(host) !== 0 && isPrivateAddress(host);
}

async function launchGuardedBrowser(): Promise<Browser> {
  const { launchBrowser } = await import("./browser");
  return launchBrowser();
}

/** 브라우저를 확실히 폐기 (크래시 상태여도 예외 없이) */
async function disposeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    // 이미 죽은 브라우저 — 무시
  }
}

interface SinglePageOutcome {
  result: PageScanResult;
  signature: PageSignature | null;
}

/** 한 페이지를 스캔해 결과 + 사이트 시그니처를 반환. 컨텍스트는 항상 정리한다. */
async function scanSinglePage(browser: Browser, url: string): Promise<SinglePageOutcome> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
    userAgent: "Mozilla/5.0 (compatible; a11ychk-bot/0.1; +https://a11ychk.com/bot)",
  });
  try {
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const req = route.request();
      // 서브리소스의 내부망 접근 차단 (SSRF 심층 방어)
      if (isBlockedHost(new URL(req.url()).hostname)) return route.abort();
      // 메모리 절약: axe는 DOM·CSS 기반이므로 무거운 리소스는 내려받지 않는다.
      const type = req.resourceType();
      if (type === "image" || type === "media" || type === "font") return route.abort();
      return route.continue();
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_TIMEOUT_MS });
    await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => undefined);
    // 시그니처는 뷰포트 변경(리플로우 검사) 전에 추출
    const signature = await extractPageSignature(page).catch(() => null);
    const result = await runAxeOnPage(page);
    return { result, signature };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** 점검자 판정을 standard별 itemId→outcome 맵으로 로드 (통합 점수용) */
async function loadReviews(
  db: SupabaseClient,
  scanId: string,
): Promise<{ wcag: Record<string, WcagOutcome>; kwcag: Record<string, WcagOutcome> }> {
  const { data } = await db.from("scan_reviews").select("standard, item_id, outcome").eq("scan_id", scanId);
  const reviews = { wcag: {} as Record<string, WcagOutcome>, kwcag: {} as Record<string, WcagOutcome> };
  for (const r of data ?? []) {
    const bucket = r.standard === "kwcag" ? reviews.kwcag : reviews.wcag;
    bucket[r.item_id as string] = r.outcome as WcagOutcome;
  }
  return reviews;
}

/** 페이지 결과를 DB에 저장 (기존 findings 교체) */
async function persistPageResult(
  db: SupabaseClient,
  pageRowId: string,
  result: PageScanResult,
  signature?: PageSignature | null,
): Promise<void> {
  await db.from("findings").delete().eq("scan_page_id", pageRowId);
  if (result.violations.length > 0) {
    const findingRows = result.violations.flatMap((v) =>
      v.nodes.map((n) => ({
        scan_page_id: pageRowId,
        rule_id: v.ruleId,
        impact: v.impact,
        tags: v.tags,
        help_url: v.helpUrl,
        selector: n.selector,
        html_snippet: n.html,
        failure_summary: n.failureSummary,
      })),
    );
    const { error } = await db.from("findings").insert(findingRows);
    if (error) throw new Error(`위반 저장 실패: ${error.message}`);
  }
  const counts: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of result.violations) counts[v.impact] = (counts[v.impact] ?? 0) + v.nodes.length;
  await db
    .from("scan_pages")
    .update({
      status: "done",
      error: null,
      violation_counts: counts,
      passes: result.passes,
      incomplete: result.incomplete,
      scanned_at: result.scannedAt,
    })
    .eq("id", pageRowId);

  // 시그니처는 별도 best-effort 업데이트 (migration 0005 미적용 시 컬럼 부재로 실패 → 무시).
  // 핵심 결과 저장을 이 부가 컬럼이 막지 않도록 분리한다.
  if (signature !== undefined) {
    await db
      .from("scan_pages")
      .update({ signature })
      .eq("id", pageRowId)
      .then(undefined, () => undefined);
  }
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
    const results: PageScanResult[] = [];
    const signatures: PageSignature[] = [];
    const structuredRules = new Set<string>();
    const randomRules = new Set<string>();

    for (const row of pageRows) {
      await db.from("scan_pages").update({ status: "running" }).eq("id", row.id);
      let lastError: Error | undefined;

      // 메모리 누적 방지: 페이지마다 브라우저를 새로 띄우고 끝나면 완전히 닫는다.
      // (Hobby 2GB 한도에서 여러 페이지에 걸친 자원 누적 → ERR_INSUFFICIENT_RESOURCES 방지)
      // 실패 시 1회 재시도 — 재시도도 깨끗한 브라우저로 실행된다.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await assertPublicHttpUrl(row.url);
          browser = await launchGuardedBrowser();
          try {
            const { result, signature } = await scanSinglePage(browser, row.url);
            await persistPageResult(db, row.id, result, signature);
            results.push(result);
            if (signature) signatures.push(signature);

            const ruleTarget = row.sample_type === "random" ? randomRules : structuredRules;
            for (const v of result.violations) ruleTarget.add(v.ruleId);
          } finally {
            await disposeBrowser(browser);
            browser = null;
          }
          lastError = undefined;
          break;
        } catch (pageError) {
          lastError = pageError as Error;
          await disposeBrowser(browser);
          browser = null;
        }
      }

      if (lastError) {
        await db
          .from("scan_pages")
          .update({ status: "failed", error: truncate(lastError.message, 500) })
          .eq("id", row.id);
      }
    }

    if (results.length === 0) {
      throw new Error(
        "모든 페이지 검사에 실패했습니다. 일시적인 자원 부족일 수 있으니 잠시 후 다시 검사해 주세요. 계속 실패하면 '봇 차단 검증' 메뉴로 사이트의 봇 차단 여부를 진단하고, 차단된 사이트는 크롬 확장으로 검사하세요.",
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
      siteChecks: computeSiteChecks(signatures),
      notPresentScs: computeNotPresentScs(signatures, results.length),
      reviews: await loadReviews(db, scanId),
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
    await disposeBrowser(browser);
  }
}

/** DB에 저장된 페이지 결과(passes/incomplete/findings)에서 PageScanResult를 복원 */
async function reconstructResults(
  db: SupabaseClient,
  scanId: string,
): Promise<{
  results: PageScanResult[];
  signatures: PageSignature[];
  structuredRules: Set<string>;
  randomRules: Set<string>;
}> {
  const { data: pages } = await db
    .from("scan_pages")
    .select("id, url, status, sample_type, passes, incomplete, scanned_at")
    .eq("scan_id", scanId);
  const donePages = (pages ?? []).filter((p) => p.status === "done");

  // 시그니처는 별도 best-effort 조회 (migration 0005 미적용 시 컬럼 부재로 실패 → 빈 맵)
  const sigById = new Map<string, PageSignature>();
  const { data: sigRows } = await db
    .from("scan_pages")
    .select("id, signature")
    .eq("scan_id", scanId)
    .then((r) => r, () => ({ data: null }));
  for (const s of sigRows ?? []) {
    if (s.signature) sigById.set(s.id as string, s.signature as PageSignature);
  }

  // 페이지네이션 전량 조회 — 절단된 findings로 재집계하면 점수가 왜곡된다
  const findings = await fetchAllRows((from, to) =>
    db
      .from("findings")
      .select("scan_page_id, rule_id, impact, tags, help_url, selector, html_snippet, failure_summary")
      .in("scan_page_id", donePages.map((p) => p.id))
      .order("id")
      .range(from, to),
  );

  const byPage = new Map<string, Map<string, Finding>>();
  for (const f of findings ?? []) {
    const pageMap = byPage.get(f.scan_page_id) ?? byPage.set(f.scan_page_id, new Map()).get(f.scan_page_id)!;
    const finding =
      pageMap.get(f.rule_id) ??
      pageMap
        .set(f.rule_id, {
          ruleId: f.rule_id,
          impact: f.impact as Impact,
          tags: (f.tags as string[]) ?? [],
          helpUrl: f.help_url ?? "",
          nodes: [],
        })
        .get(f.rule_id)!;
    finding.nodes.push({ selector: f.selector, html: f.html_snippet, failureSummary: f.failure_summary });
  }

  const results: PageScanResult[] = [];
  const signatures: PageSignature[] = [];
  const structuredRules = new Set<string>();
  const randomRules = new Set<string>();
  for (const p of donePages) {
    const violations = [...(byPage.get(p.id)?.values() ?? [])];
    results.push({
      url: p.url,
      violations,
      passes: (p.passes as string[]) ?? [],
      incomplete: (p.incomplete as string[]) ?? [],
      scannedAt: p.scanned_at ?? new Date().toISOString(),
    });
    const sig = sigById.get(p.id);
    if (sig) signatures.push(sig);
    const target = p.sample_type === "random" ? randomRules : structuredRules;
    for (const v of violations) target.add(v.ruleId);
  }
  return { results, signatures, structuredRules, randomRules };
}

/** 저장된 페이지 결과 전체로 scans.summary를 다시 집계 */
export async function reaggregate(db: SupabaseClient, scanId: string): Promise<void> {
  const { data: scan } = await db.from("scans").select("*").eq("id", scanId).single();
  if (!scan) return;
  const scope = (scan.scope ?? null) as EvaluationScope | null;

  const { count: totalPages } = await db
    .from("scan_pages")
    .select("id", { count: "exact", head: true })
    .eq("scan_id", scanId);

  const { results, signatures, structuredRules, randomRules } = await reconstructResults(db, scanId);
  if (results.length === 0) return;

  const prevSample = (scan.summary as { sample?: SampleSummary } | null)?.sample;
  const sampleSummary: SampleSummary | undefined = prevSample
    ? { ...prevSample, randomSurfacedNewRules: [...randomRules].filter((r) => !structuredRules.has(r)) }
    : undefined;

  const summary = aggregateScan(results, AXE_VERSION, {
    conformanceTarget: scope?.conformanceTarget ?? "AA",
    sample: sampleSummary,
    plannedPageCount: totalPages ?? results.length,
    siteChecks: computeSiteChecks(signatures),
    notPresentScs: computeNotPresentScs(signatures, results.length),
    reviews: await loadReviews(db, scanId),
  });
  await db
    .from("scans")
    .update({ status: "done", error: null, summary, finished_at: new Date().toISOString() })
    .eq("id", scanId);
}

/**
 * 실패한 단일 페이지 재검사 — 성공하면 findings를 교체하고 보고서 전체를 재집계한다.
 * 새 브라우저를 페이지 전용으로 띄워 실행 (자원 격리).
 */
export async function rescanPage(scanId: string, pageId: string): Promise<{ ok: boolean; error?: string }> {
  const db = createAdminClient();
  const { data: page } = await db
    .from("scan_pages")
    .select("id, url, status, scan_id")
    .eq("id", pageId)
    .eq("scan_id", scanId)
    .maybeSingle();
  if (!page) return { ok: false, error: "페이지를 찾을 수 없습니다." };
  if (page.status !== "failed") return { ok: false, error: "실패한 페이지만 재검사할 수 있습니다." };

  await db.from("scan_pages").update({ status: "running", error: null }).eq("id", pageId);

  let browser: Browser | null = null;
  try {
    await assertPublicHttpUrl(page.url);
    browser = await launchGuardedBrowser();
    const { result, signature } = await scanSinglePage(browser, page.url);
    await persistPageResult(db, pageId, result, signature);
    await reaggregate(db, scanId);
    return { ok: true };
  } catch (e) {
    await db
      .from("scan_pages")
      .update({ status: "failed", error: truncate((e as Error).message, 500) })
      .eq("id", pageId);
    return { ok: false, error: "재검사에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  } finally {
    await disposeBrowser(browser);
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
