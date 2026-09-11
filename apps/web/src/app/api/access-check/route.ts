import { NextResponse } from "next/server";
import { z } from "zod";
import { UrlGuardError, assertPublicHttpUrl, checkBotAccess } from "@a11ychk/core";
import { createClient } from "@/lib/supabase/server";
import { apiError, resolveApiLocale } from "@/lib/apiError";
import { allowRate } from "@/lib/rateLimit";

export const maxDuration = 60;

const BodySchema = z.object({ url: z.string().min(1).max(2000) });

// 사용자별 시간당 진단 횟수 제한 (서버가 임의 공개 URL을 fetch하는 증폭 방지).
// 공유 스토어(lib/rateLimit)가 설정돼 있으면 인스턴스 간 공유, 아니면 인메모리 best-effort.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 3600_000;

/** 봇 차단 검증 — 자동 검사 가능 여부와 차단 방식을 진단 (로그인 필요, 검사 한도 미차감) */
export async function POST(request: Request) {
  const locale = resolveApiLocale(request);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError(locale, "loginRequired", 401);
  if (!(await allowRate(`access-check:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return apiError(locale, "rateLimited", 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(locale, "invalidBody", 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return apiError(locale, "invalidInput", 400);

  try {
    const url = await assertPublicHttpUrl(parsed.data.url);
    const result = await checkBotAccess(url.toString());
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof UrlGuardError) {
      // UrlGuardError.code → i18n 코드 (scans 라우트와 동일 매핑) — 클라이언트가 번역
      return NextResponse.json(
        { error: e.message, code: `url_${e.code.replaceAll("-", "_")}` },
        { status: 400 },
      );
    }
    return apiError(locale, "checkFailed", 500);
  }
}
