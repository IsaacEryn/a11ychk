import { NextResponse } from "next/server";
import { z } from "zod";
import {
  UrlGuardError,
  aggregateScan,
  assertPublicHttpUrl,
  fetchRobots,
  isPathAllowed,
  normalizeUrl,
  AXE_VERSION,
} from "@a11ychk/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { disposeBrowser, launchGuardedBrowser, scanSinglePage } from "@/lib/scan/runScan";
import { verifyTurnstileToken } from "@/lib/turnstile";
import {
  TEASER_GLOBAL_DAILY_CAP,
  TEASER_GLOBAL_KEY,
  TEASER_IP_DAILY_LIMIT,
  buildTeaserResult,
  hashIp,
  type TeaserResult,
} from "@/lib/teaser";

// 단일 페이지 검사(런치 2–4s + 로드·axe 2-패스 ≤ 55s 캡)라 60s면 충분
export const maxDuration = 60;

const BodySchema = z.object({
  url: z.string().min(1).max(2000),
  token: z.string().max(4000).optional(),
  locale: z.enum(["ko", "en"]).default("ko"),
});

/** 페이지 하드 타임아웃 — runScan의 PAGE_SCAN_TIMEOUT_MS(55s)보다 짧게(함수 60s 내 정리 여유) */
const TEASER_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 동일 URL 단기 캐시 — 인기 페이지 반복 검사·새로고침 재호출 비용을 0으로.
 * 인스턴스 로컬(best-effort)이며 캐시 히트는 쿼터를 소비하지 않는다.
 */
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 50;
const resultCache = new Map<string, { at: number; ko: TeaserResult | null; en: TeaserResult | null }>();

function err(code: string, status: number): NextResponse {
  return NextResponse.json({ code }, { status });
}

/**
 * 비로그인 맛보기 검사 — 입력 URL 1페이지만 즉석 검사해 트리밍된 결과를 반환한다.
 * DB에 검사 기록을 만들지 않는다(어뷰즈 카운터만). 방어 순서:
 * 캐시 → Turnstile(서버 검증, fail-closed) → IP 한도(2/일) → 전역 캡(100/일)
 * → robots.txt 존중 → SSRF 가드(공개 URL + DNS 핀 브라우저) → 45s 타임아웃.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("invalidUrl", 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return err("invalidUrl", 400);
  const locale = parsed.data.locale;

  // SSRF 1차 — 공개 http(s) URL만
  let url: URL;
  try {
    url = await assertPublicHttpUrl(parsed.data.url);
  } catch (e) {
    return err(e instanceof UrlGuardError ? "invalidUrl" : "invalidUrl", 400);
  }
  const cacheKey = normalizeUrl(url.toString()) ?? url.toString();

  // 캐시 히트 — 쿼터 미소비 (같은 페이지 재검사·새로고침 흡수)
  const cachedEntry = resultCache.get(cacheKey);
  if (cachedEntry && Date.now() - cachedEntry.at < CACHE_TTL_MS) {
    const hit = cachedEntry[locale];
    if (hit) return NextResponse.json({ ...hit, cached: true });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  // 봇 방지 — Turnstile 서버 검증 (사이트키 설정 시 필수, fail-closed)
  const captcha = await verifyTurnstileToken(parsed.data.token, ip === "unknown" ? undefined : ip);
  if (captcha === "misconfigured") return err("unavailable", 503);
  if (captcha !== "ok") return err("captcha", 403);

  // 어뷰즈 카운터 — IP 한도 먼저(IP 제한에 걸린 스팸이 전역 예산을 소모하지 못하게), 그다음 전역 캡.
  // RPC 실패(마이그레이션 0025 미적용 포함)는 fail-closed — 맛보기만 비활성.
  const admin = createAdminClient();
  const day = new Date().toISOString().slice(0, 10);
  const ipRes = await admin.rpc("increment_teaser_usage", {
    p_ip_hash: hashIp(ip),
    p_day: day,
    p_limit: TEASER_IP_DAILY_LIMIT,
  });
  if (ipRes.error) return err("unavailable", 503);
  if (typeof ipRes.data !== "number" || ipRes.data < 0) return err("ipLimit", 429);
  const globalRes = await admin.rpc("increment_teaser_usage", {
    p_ip_hash: TEASER_GLOBAL_KEY,
    p_day: day,
    p_limit: TEASER_GLOBAL_DAILY_CAP,
  });
  if (globalRes.error) return err("unavailable", 503);
  if (typeof globalRes.data !== "number" || globalRes.data < 0) return err("globalCap", 429);

  // robots.txt 존중 — 자동 검사를 거부한 페이지는 검사하지 않는다 (본검사 정책과 일관)
  try {
    const robots = await fetchRobots(url.origin);
    if (!isPathAllowed(robots, url.pathname)) return err("robots", 422);
  } catch {
    // robots 조회 실패는 허용(파일 부재 등) — fetchRobots가 내부에서 관용 처리하지만 이중 방어
  }

  // 검사 실행 — 저장 없음(persistPageResult 미호출)
  let browser = null;
  try {
    browser = await launchGuardedBrowser(url.toString());
    const { result: page } = await withTimeout(scanSinglePage(browser, url.toString()), TEASER_TIMEOUT_MS);
    const summary = aggregateScan([page], AXE_VERSION);
    const payload = buildTeaserResult(page, summary, locale);

    // 관리자 통계 기록 (best-effort — 0026 미적용/일시 오류여도 응답은 정상 반환)
    // 호스트명·요약 수치만 저장: 경로·쿼리(개인정보 가능성)·IP·결과 상세는 저장하지 않는다.
    await admin
      .from("teaser_scans")
      .insert({
        hostname: url.hostname,
        rate: payload.rate,
        rule_count: payload.ruleCount,
        node_count: payload.totalNodes,
        by_impact: payload.byImpact,
        locale,
      })
      .then(
        () => undefined,
        () => undefined,
      );

    // 양 로케일 슬롯 캐시 (같은 URL을 다른 언어로 봐도 재검사 없이 트리밍만 다시)
    const other = locale === "ko" ? "en" : "ko";
    resultCache.set(cacheKey, {
      at: Date.now(),
      [locale]: payload,
      [other]: buildTeaserResult(page, summary, other),
    } as { at: number; ko: TeaserResult | null; en: TeaserResult | null });
    if (resultCache.size > CACHE_MAX) {
      const oldest = [...resultCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) resultCache.delete(oldest[0]);
    }

    return NextResponse.json(payload);
  } catch {
    // 실패 사유는 페이지 컨텍스트에서 올 수 있어 메시지를 그대로 노출하지 않는다
    return err("scanFailed", 422);
  } finally {
    await disposeBrowser(browser);
  }
}
