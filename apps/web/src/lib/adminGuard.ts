import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/user";
import { adminBasePath } from "@/lib/adminSlug";
import { ADMIN_TS_COOKIE, isIdleExpired, verifyAdminTs } from "@/lib/adminIdleCookie";

/** 렌더 스코프 캐시 — layout과 page가 각각 가드를 호출해도 role 조회는 1회만 */
const getCachedRole = cache(async (userId: string): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).single();
  return (data?.role as string | null) ?? null;
});

/** 렌더 스코프 캐시 — AAL 판정(JWT 로컬 디코드)도 layout+page 간 1회만 */
const getCachedAal = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data;
});

/** proxy가 넣은 외부(슬러그) 경로 — 로그인·MFA 후 돌아올 returnTo */
async function externalPath(locale: string): Promise<string> {
  const h = await headers();
  const p = h.get("x-pathname");
  // 내부 /admin 경로가 노출되지 않도록 슬러그 기준 외부 경로만 신뢰, 없으면 기준 경로
  return p && p.startsWith("/") && !p.startsWith("//") ? p : adminBasePath(locale);
}

/**
 * 관리자 확인 — 모든 관리자 page 컴포넌트 최상단에서 호출할 것.
 * 레이아웃의 가드만으로는 부족하다: Next.js는 layout과 page를 병렬 렌더하므로
 * layout의 redirect가 발생해도 page 본문(RSC 페이로드)이 이미 스트리밍될 수 있다.
 * 데이터 조회 전에 page 스스로 검증해야 비인가 응답에 데이터가 실리지 않는다.
 *
 * 검증 사슬: 로그인 → role → MFA(TOTP 등록·AAL2 세션) → 무활동(20분) 순.
 */
export async function requireAdmin(locale: string): Promise<void> {
  const user = await getCachedUser(); // 렌더 스코프 캐시 — layout 가드와 왕복 공유
  const returnTo = await externalPath(locale);
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(returnTo)}`);
  if ((await getCachedRole(user.id)) !== "admin") redirect(`/${locale}/dashboard`);

  // 필수 2단계 인증 — factor 미등록이면 등록으로, 등록됐는데 이 세션이 AAL1이면 챌린지로
  const aal = await getCachedAal();
  if (aal?.nextLevel !== "aal2") redirect(`/${locale}/login/mfa/setup?next=${encodeURIComponent(returnTo)}`);
  if (aal.currentLevel !== "aal2") redirect(`/${locale}/login/mfa?next=${encodeURIComponent(returnTo)}`);

  // 무활동 타임아웃 — 쿠키 부재·변조·초과 시 세션 종료(route handler 경유: RSC는 쿠키 쓰기 불가)
  const ts = await verifyAdminTs((await cookies()).get(ADMIN_TS_COOKIE)?.value);
  if (ts === null || isIdleExpired(ts)) {
    redirect(`/auth/admin-timeout?next=${encodeURIComponent(returnTo)}&locale=${locale}`);
  }
}
