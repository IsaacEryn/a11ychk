import { NextResponse, after } from "next/server";
import { z } from "zod";
import { UrlGuardError, assertPublicHttpUrl, isSameOrigin, normalizeUrl, type EvaluationScope } from "@a11ychk/core";
import { createClient } from "@/lib/supabase/server";
import { createScanForUser } from "@/lib/scan/createScan";
import { runScan } from "@/lib/scan/runScan";
import { MAX_PAGES_PER_SCAN } from "@/lib/quota";

// Vercel Fluid Compute — after() 콜백(스캔 실행)까지 포함한 최대 실행 시간
export const maxDuration = 300;

/** 한국 기본 접근성 지원 기준 (WCAG-EM Step 1.c 프리셋) */
const DEFAULT_BASELINE = [
  "NVDA + Chrome (Windows)",
  "VoiceOver + Safari (macOS/iOS)",
  "센스리더 + Chrome (Windows)",
  "TalkBack + Chrome (Android)",
];

const CreateScanSchema = z.object({
  url: z.string().min(1).max(2000),
  /** 점검자 직접 입력 표본 (없으면 자동 수집) */
  pages: z.array(z.string().min(1).max(2000)).max(MAX_PAGES_PER_SCAN).optional(),
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
  // 1) 인증
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다.", code: "loginRequired" }, { status: 401 });
  }

  // 2) 입력 검증
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다.", code: "invalidInput" }, { status: 400 });
  }
  const parsed = CreateScanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "검사할 URL을 입력해 주세요.", code: "invalidInput" }, { status: 400 });
  }

  // 3) SSRF 가드 (형식 + DNS 검증)
  let url: URL;
  try {
    url = await assertPublicHttpUrl(parsed.data.url);
  } catch (e) {
    const message = e instanceof UrlGuardError ? e.message : "URL을 확인할 수 없습니다.";
    // UrlGuardError.code → i18n 코드 (invalid-url → url_invalid_url)
    const code = e instanceof UrlGuardError ? `url_${e.code.replaceAll("-", "_")}` : "urlUnknown";
    return NextResponse.json({ error: message, code }, { status: 400 });
  }

  // 4) 점검자 직접 입력 표본 검증: 정규화 → 같은 origin만 → 중복 제거
  let manualPages: string[] | undefined;
  if (parsed.data.pages && parsed.data.pages.length > 0) {
    const seen = new Set<string>();
    for (const raw of parsed.data.pages) {
      const normalized = normalizeUrl(raw);
      if (!normalized || !isSameOrigin(normalized, url.origin)) {
        return NextResponse.json(
          {
            error: `검사 주소와 다른 도메인이거나 올바르지 않은 페이지가 있습니다: ${raw}`,
            code: "pageOtherDomain",
            params: { url: raw },
          },
          { status: 400 },
        );
      }
      seen.add(normalized);
    }
    manualPages = [...seen];
    if (manualPages.length === 0) {
      return NextResponse.json({ error: "검사할 페이지를 1개 이상 입력해 주세요.", code: "pagesEmpty" }, { status: 400 });
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

  const result = await createScanForUser(user.id, url, scope, { strictManualLimit: true });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code, params: result.params }, { status: result.status });
  }

  // 6) 응답 반환 후 백그라운드에서 스캔 실행
  after(() => runScan(result.id));

  return NextResponse.json({ id: result.id }, { status: 202 });
}
