import { NextResponse } from "next/server";
import { z } from "zod";
import { UrlGuardError, assertPublicHttpUrl, checkBotAccess } from "@a11ychk/core";
import { createClient } from "@/lib/supabase/server";
import { apiError, resolveApiLocale } from "@/lib/apiError";

export const maxDuration = 60;

const BodySchema = z.object({ url: z.string().min(1).max(2000) });

// 사용자별 시간당 진단 횟수 제한 (서버가 임의 공개 URL을 fetch하는 증폭 방지).
// 인스턴스 메모리 기반 best-effort — 서버리스 특성상 완전하진 않지만 버스트를 차단한다.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 3600_000;
const rateBuckets = new Map<string, number[]>();

function checkRate(userId: string): boolean {
  const now = Date.now();
  const stamps = (rateBuckets.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (stamps.length >= RATE_LIMIT) {
    rateBuckets.set(userId, stamps);
    return false;
  }
  stamps.push(now);
  rateBuckets.set(userId, stamps);
  return true;
}

/** 봇 차단 검증 — 자동 검사 가능 여부와 차단 방식을 진단 (로그인 필요, 검사 한도 미차감) */
export async function POST(request: Request) {
  const locale = resolveApiLocale(request);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError(locale, "loginRequired", 401);
  if (!checkRate(user.id)) {
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
