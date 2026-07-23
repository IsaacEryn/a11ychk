import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/user";

/** 렌더 스코프 캐시 — layout과 page가 각각 가드를 호출해도 role 조회는 1회만 */
const getCachedRole = cache(async (userId: string): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).single();
  return (data?.role as string | null) ?? null;
});

/**
 * 관리자 확인 — 모든 관리자 page 컴포넌트 최상단에서 호출할 것.
 * 레이아웃의 가드만으로는 부족하다: Next.js는 layout과 page를 병렬 렌더하므로
 * layout의 redirect가 발생해도 page 본문(RSC 페이로드)이 이미 스트리밍될 수 있다.
 * 데이터 조회 전에 page 스스로 검증해야 비인가 응답에 데이터가 실리지 않는다.
 */
export async function requireAdmin(locale: string): Promise<void> {
  const user = await getCachedUser(); // 렌더 스코프 캐시 — layout 가드와 왕복 공유
  if (!user) redirect(`/${locale}/login`);
  if ((await getCachedRole(user.id)) !== "admin") redirect(`/${locale}/dashboard`);
}
