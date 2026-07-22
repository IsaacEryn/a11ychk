import "server-only";
import net from "node:net";
import { lookup } from "node:dns/promises";
import type { Browser } from "playwright-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AXE_VERSION,
  aggregateScan,
  assertPublicHost,
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

/**
 * 전체 스캔 시간 예산. 라우트 maxDuration=300s를 넘기면 함수가 강제 종료되어
 * 검사가 running에 갇히므로(좀비), 그 전에 루프를 멈추고 '부분 결과'로 완료한다.
 * 표본 수집(buildSample)·집계·DB 기록·브라우저 정리 여유를 두어 210s로 잡는다.
 */
const SCAN_BUDGET_MS = 210_000;

/**
 * 페이지 동시 스캔 수. 같은 origin 표본이라 한 브라우저(host-resolver 핀 공유)에
 * 컨텍스트를 N개 띄워 동시에 검사한다. 메모리(서버리스 크로미엄 + axe DOM 직렬화)가
 * 하드캡이라 기본 2 — 함수 메모리 상향 없이 3+는 ERR_INSUFFICIENT_RESOURCES 위험.
 * OOM이 보이면 A11YCHK_SCAN_CONCURRENCY=1로 재배포 없이 즉시 백오프할 수 있다(1~3 클램프).
 */
const SCAN_CONCURRENCY = Math.min(3, Math.max(1, Number(process.env.A11YCHK_SCAN_CONCURRENCY) || 2));

/** 스캔 페이지 행(오케스트레이터 내부용 경량 타입) */
type ScanPageRow = { id: string; url: string; sample_type: string | null };

/**
 * 단일 페이지 하드 타임아웃. goto(20s)·load·폰트·2패스 axe 합이 비정상적으로 길어지는
 * 페이지 하나가 전체 예산을 삼키지 않도록 캡을 둔다.
 */
const PAGE_SCAN_TIMEOUT_MS = 55_000;

/** 프라미스에 타임아웃을 건다(초과 시 reject). 원 프라미스는 race가 계속 참조하므로 미처리 거부 없음. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 서브리소스 요청의 내부망 접근 차단 (SSRF 심층 방어).
 * 리터럴 IP는 즉시 판정하고, 호스트네임은 DNS로 해석해 사설 대역이면 차단한다.
 * (호스트네임이 사설 IP로 해석되는 rebinding·내부 참조를 막는다)
 * 결과는 스캔 컨텍스트별 캐시로 재조회를 줄인다.
 */
async function isBlockedHost(hostname: string, cache: Map<string, boolean>): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const cached = cache.get(host);
  if (cached !== undefined) return cached;

  let blocked: boolean;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    blocked = true;
  } else if (net.isIP(host) !== 0) {
    blocked = isPrivateAddress(host);
  } else {
    try {
      const addrs = await lookup(host, { all: true, verbatim: true });
      blocked = addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address));
    } catch {
      blocked = true; // 해석 실패 → 안전하게 차단
    }
  }
  cache.set(host, blocked);
  return blocked;
}

/** 대상 URL을 검증하고, 검증된 공개 IP를 브라우저 DNS 핀 규칙으로 굳혀 실행 */
async function launchGuardedBrowser(targetUrl?: string): Promise<Browser> {
  const { launchBrowser, buildHostResolverRule } = await import("./browser");
  let rule: string | undefined;
  if (targetUrl) {
    try {
      const url = new URL(targetUrl);
      const host = url.hostname.replace(/^\[|\]$/g, "");
      // 리터럴 IP는 rebinding 대상이 아니므로 규칙 불필요
      if (net.isIP(host) === 0) {
        const vetted = await assertPublicHost(url);
        if (vetted[0]) rule = buildHostResolverRule(host, vetted[0].address);
      }
    } catch {
      // 검증 실패는 이후 assertPublicHttpUrl에서 처리 — 여기선 규칙 없이 진행
    }
  }
  return launchBrowser(rule);
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
    // 애니메이션 감속 — 페이드인 도중 반투명 상태를 axe가 측정해 생기는
    // 명도 대비 오탐을 방지한다 (모든 검사 대상 공통)
    reducedMotion: "reduce",
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
    userAgent: "Mozilla/5.0 (compatible; a11ychk-bot/0.1; +https://a11ychk.com/bot)",
  });
  const hostCache = new Map<string, boolean>();
  try {
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      const req = route.request();
      // 메모리 절약: axe는 DOM·CSS 기반이므로 무거운 리소스(이미지·미디어)는
      // 내려받지 않는다. 웹폰트는 허용 — 폴백 폰트로 측정하면 글자 크기·두께가
      // 달라져 명도 대비의 대형 텍스트 임계(3:1 vs 4.5:1) 판정이 왜곡된다.
      const type = req.resourceType();
      if (type === "image" || type === "media") return route.abort();
      // 서브리소스의 내부망 접근 차단 (SSRF 심층 방어 — 호스트네임 해석 포함)
      try {
        if (await isBlockedHost(new URL(req.url()).hostname, hostCache)) return route.abort();
      } catch {
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_TIMEOUT_MS });
    await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => undefined);
    // 실제 폰트가 적용된 상태에서 측정 (로딩이 느린 사이트는 3초까지만 대기)
    await Promise.race([
      page.evaluate(() => document.fonts.ready.then(() => undefined)),
      page.waitForTimeout(3_000),
    ]).catch(() => undefined);
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
 * 도메인 설정의 제외 규칙 조회 — 오탐 관리 (migration 0023).
 * 컬럼 미적용(마이그레이션 전)·도메인 미연결이면 빈 목록으로 동작한다.
 */
async function loadDisabledRules(db: SupabaseClient, domainId: string | null): Promise<Set<string>> {
  if (!domainId) return new Set();
  try {
    const { data } = await db.from("domains").select("disabled_rules").eq("id", domainId).maybeSingle();
    const rules = (data as { disabled_rules?: unknown } | null)?.disabled_rules;
    return new Set(
      Array.isArray(rules) ? rules.filter((r): r is string => typeof r === "string").slice(0, 50) : [],
    );
  } catch {
    return new Set();
  }
}

/** 제외 규칙 적용 — 해당 규칙의 위반을 결과에서 제거 (저장·집계 전에 호출) */
function applyDisabledRules(result: PageScanResult, disabled: Set<string>): void {
  if (disabled.size === 0) return;
  result.violations = result.violations.filter((v) => !disabled.has(v.ruleId));
}

/**
 * 스캔 오케스트레이터.
 * POST /api/scans에서 after()로 호출된다 — 사용자 응답 이후 백그라운드 실행.
 * 실패해도 throw하지 않고 scans.status='failed'로 기록한다.
 */
export async function runScan(scanId: string): Promise<void> {
  const db = createAdminClient();

  const { data: scan, error: loadError } = await db.from("scans").select("*").eq("id", scanId).single();
  // queued(직접 호출) 또는 running(드레이너가 claim_scans로 이미 선점)만 진행.
  // done/failed는 재실행 방지. claim의 SKIP LOCKED + 단일 디스패치가 중복 실행을 막는다.
  if (loadError || !scan || (scan.status !== "queued" && scan.status !== "running")) return;

  // 아직 queued면(직접 호출 경로) running으로 전환. 이미 running이면(claim됨) started_at 보존.
  if (scan.status === "queued") {
    await db.from("scans").update({ status: "running", started_at: new Date().toISOString() }).eq("id", scanId);
  }

  const scope = (scan.scope ?? null) as EvaluationScope | null;
  const conformanceTarget: WcagLevel | "AAA" = scope?.conformanceTarget ?? "AA";
  // 도메인 오탐 관리 — 소유자가 제외 지정한 규칙은 이번 검사부터 위반에서 뺀다
  const disabledRules = await loadDisabledRules(db, (scan.domain_id as string | null) ?? null);

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

    // 3) 페이지 스캔 — 동시 SCAN_CONCURRENCY개(한 브라우저에 컨텍스트 N개)로 배치 처리.
    //    같은 origin 표본이라 host-resolver 핀을 공유하므로 한 브라우저로 안전하다(SSRF).
    //    메모리는 배치마다 브라우저를 닫아 리셋한다(2 동시 = ERR_INSUFFICIENT_RESOURCES 여유).
    //    구조/무작위 표본별 위반 규칙 추적(WCAG-EM 4.c).
    const results: PageScanResult[] = [];
    const signatures: PageSignature[] = [];
    const structuredRules = new Set<string>();
    const randomRules = new Set<string>();

    // 시간 예산 — 초과 시 남은 페이지는 두고 부분 결과로 완료한다(강제 종료·좀비 방지)
    const scanStarted = Date.now();
    let budgetExceeded = false;
    const overBudget = () => Date.now() - scanStarted > SCAN_BUDGET_MS;

    const pages = pageRows as ScanPageRow[];

    // 주어진 브라우저에서 한 페이지 스캔. 성공 시 결과 반영(done 기록), 실패 시 Error 반환.
    const scanRow = async (b: Browser, row: ScanPageRow): Promise<Error | null> => {
      try {
        await assertPublicHttpUrl(row.url);
        // 페이지별 하드 타임아웃 — 한 페이지가 예산을 통째로 삼키지 않게 캡
        const { result, signature } = await withTimeout(
          scanSinglePage(b, row.url),
          PAGE_SCAN_TIMEOUT_MS,
          `페이지 검사 시간 초과 (${Math.round(PAGE_SCAN_TIMEOUT_MS / 1000)}초)`,
        );
        applyDisabledRules(result, disabledRules);
        await persistPageResult(db, row.id, result, signature);
        results.push(result);
        if (signature) signatures.push(signature);
        const ruleTarget = row.sample_type === "random" ? randomRules : structuredRules;
        for (const v of result.violations) ruleTarget.add(v.ruleId);
        return null;
      } catch (e) {
        return e as Error;
      }
    };

    // 한 배치(≤N)를 한 브라우저로 동시 스캔. 실패한 row.id → Error 맵. 브라우저는 항상 정리.
    const runBatch = async (rows: ScanPageRow[]): Promise<Map<string, Error>> => {
      const errors = new Map<string, Error>();
      try {
        browser = await launchGuardedBrowser(rows[0].url);
        const b = browser;
        const outcomes = await Promise.all(rows.map((row) => scanRow(b, row)));
        rows.forEach((row, i) => {
          const e = outcomes[i];
          if (e) errors.set(row.id, e);
        });
      } catch (launchErr) {
        // 브라우저 실행 실패 → 배치 전체 실패(재시도 대상)
        for (const row of rows) errors.set(row.id, launchErr as Error);
      } finally {
        await disposeBrowser(browser);
        browser = null;
      }
      return errors;
    };

    // 1차 패스 — 예산 내에서 N개씩 배치. 실패 페이지는 재시도 큐로.
    const retryQueue: ScanPageRow[] = [];
    for (let i = 0; i < pages.length; i += SCAN_CONCURRENCY) {
      if (overBudget()) {
        budgetExceeded = true;
        break;
      }
      const batch = pages.slice(i, i + SCAN_CONCURRENCY);
      await db.from("scan_pages").update({ status: "running" }).in("id", batch.map((r) => r.id));
      const errs = await runBatch(batch);
      for (const row of batch) if (errs.has(row.id)) retryQueue.push(row);
    }

    // 2차 패스 — 실패 페이지 1회 재시도(깨끗한 브라우저). 재시도도 실패하면 사유 기록.
    for (let i = 0; i < retryQueue.length; i += SCAN_CONCURRENCY) {
      if (overBudget()) {
        budgetExceeded = true;
        break;
      }
      const batch = retryQueue.slice(i, i + SCAN_CONCURRENCY);
      const errs = await runBatch(batch);
      for (const row of batch) {
        const e = errs.get(row.id);
        if (e) {
          await db.from("scan_pages").update({ status: "failed", error: truncate(e.message, 500) }).eq("id", row.id);
        }
      }
    }

    // 최종 정리 — done/failed 확정 외 남은 페이지(pending=미도달, running=예산 초과로
    // 재시도 못 함)를 실패로 표시한다(조용한 누락 방지 + 개별 재검사 버튼 노출).
    const leftoverMsg = budgetExceeded
      ? "TIMEOUT: 전체 검사 시간이 초과되어 이 페이지는 검사하지 못했습니다. 페이지별 재검사 또는 '동일 조건 재검사'로 마저 검사할 수 있습니다."
      : "검사를 완료하지 못했습니다. 다시 시도해 주세요.";
    await db
      .from("scan_pages")
      .update({ status: "failed", error: leftoverMsg })
      .eq("scan_id", scanId)
      .in("status", ["pending", "running"]);

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
    // 제외 규칙이 적용됐으면 보고서에 투명하게 고지할 수 있도록 기록
    if (disabledRules.size > 0) summary.excludedRules = [...disabledRules].sort();
    await db
      .from("scans")
      // error: null — 자동 재시도(reclaimStale의 auto-retry 마커) 후 성공하면 마커를 지운다
      .update({ status: "done", summary, error: null, finished_at: new Date().toISOString() })
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
  // 검사 당시 적용된 제외 규칙 고지를 보존 (재집계는 저장된 findings 기준이라 동일 적용 상태)
  const prevExcluded = (scan.summary as { excludedRules?: string[] } | null)?.excludedRules;
  if (prevExcluded && prevExcluded.length > 0) summary.excludedRules = prevExcluded;
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
    browser = await launchGuardedBrowser(page.url);
    const { result, signature } = await scanSinglePage(browser, page.url);
    // 본검사와 동일한 제외 규칙 적용 (도메인 오탐 관리)
    const { data: scanRow } = await db.from("scans").select("domain_id").eq("id", scanId).maybeSingle();
    applyDisabledRules(result, await loadDisabledRules(db, (scanRow?.domain_id as string | null) ?? null));
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
