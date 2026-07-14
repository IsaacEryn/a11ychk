import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** 요청 쿠키 기반 서버 클라이언트 — RLS가 사용자 권한으로 적용됨 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Component에서 호출된 경우 — 미들웨어가 세션을 갱신하므로 무시 가능
          }
        },
      },
    },
  );
}
