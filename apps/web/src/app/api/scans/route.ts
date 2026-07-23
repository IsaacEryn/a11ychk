import { NextResponse, after } from "next/server";
import { z } from "zod";
import { UrlGuardError, assertPublicHttpUrl, isSameOrigin, normalizeUrl, type EvaluationScope } from "@a11ychk/core";
import { createClient } from "@/lib/supabase/server";
import { apiError, resolveApiLocale, type ApiErrorCode } from "@/lib/apiError";
import { DEFAULT_BASELINE, createScanForUser } from "@/lib/scan/createScan";
import { drainQueue } from "@/lib/scan/drain";
import { MAX_PAGES_PER_SCAN } from "@/lib/quota";

// Vercel Fluid Compute — after() 콜백(스캔 실행)까지 포함한 최대 실행 시간
export const maxDuration = 300;


const CreateScanSchema = z.object({
  url: z.string().min(1).max(2000),
  /** 점검자 직접 입력 표본 (없으면 자동 수집) */
  pages: z.array(z.string().min(1).max(2000)).max(MAX_PAGES_PER_SCAN).optional(),
  /** 자동 수집 시 검사할 페이지 수 — 서버가 사용자 한도로 재클램프 */
  pageCount: z.number().int().min(1).max(MAX_PAGES_PER_SCAN).optional(),
  scope: z
    .object({
      conformanceTarget: z.enum(["A", "AA", "AAA"]).optional(),
      accessibilitySupportBaseline: z.array(z.string().max(120)).max(20).optional(),
      includePatterns: z.array(z.string().max(300)).max(30).optional(),
      excludePatterns: z.array(z.string().max(300)).max(30).optional(),
      notes: z.string().max(2000).optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const locale = resolveApiLocale(request);
  // 1) 인증
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return apiError(locale, "loginRequired", 401);
  }

  // 2) 입력 검증
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(locale, "invalidBody", 400);
  }
  const parsed = CreateScanSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(locale, "invalidInput", 400);
  }

  // 3) SSRF 가드 (형식 + DNS 검증)
  let url: URL;
  try {
    url = await assertPublicHttpUrl(parsed.data.url);
  } catch (e) {
    // UrlGuardError.code → i18n 코드 (invalid-url → url_invalid_url) — 전 코드가 MESSAGES에 등재됨
    const code = (e instanceof UrlGuardError ? `url_${e.code.replaceAll("-", "_")}` : "urlUnknown") as ApiErrorCode;
    return apiError(locale, code, 400);
  }

  // 4) 점검자 직접 입력 표본 검증: 정규화 → 같은 origin만 → 중복 제거
  let manualPages: string[] | undefined;
  if (parsed.data.pages && parsed.data.pages.length > 0) {
    const seen = new Set<string>();
    for (const raw of parsed.data.pages) {
      const normalized = normalizeUrl(raw);
      if (!normalized || !isSameOrigin(normalized, url.origin)) {
        return apiError(locale, "pageOtherDomain", 400, { params: { url: raw } });
      }
      seen.add(normalized);
    }
    manualPages = [...seen];
    if (manualPages.length === 0) {
      return apiError(locale, "pagesEmpty", 400);
    }
  }

  // 5) WCAG-EM Step 1 평가 범위 (미입력 시 합리적 기본값) → 생성 정책 공통 처리
  const scope: EvaluationScope = {
    conformanceTarget: parsed.data.scope?.conformanceTarget ?? "AA",
    accessibilitySupportBaseline: parsed.data.scope?.accessibilitySupportBaseline?.length
      ? parsed.data.scope.accessibilitySupportBaseline
      : DEFAULT_BASELINE,
    includePatterns: parsed.data.scope?.includePatterns,
    excludePatterns: parsed.data.scope?.excludePatterns,
    manualPages,
    notes: parsed.data.scope?.notes,
  };

  const result = await createScanForUser(user.id, url, scope, {
    strictManualLimit: true,
    // 자동 수집일 때만 페이지 수 선택 반영 (직접 입력 표본은 배열 길이가 곧 페이지 수)
    requestedPages: manualPages ? undefined : parsed.data.pageCount,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code, params: result.params }, { status: result.status });
  }

  // 6) 응답 반환 후 백그라운드에서 큐 드레인 — 전역 동시 상한(MAX) 내에서만 실행,
  //    초과분은 queued로 대기하다가 슬롯이 비면 자동 시작(드레인 루프).
  after(() => drainQueue());

  return NextResponse.json({ id: result.id }, { status: 202 });
}
