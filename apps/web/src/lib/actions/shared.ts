/** 서버 액션 공통 헬퍼 — "use server" 파일은 async 함수만 export 가능하므로 별도 모듈에 둔다 */
import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** 전 경로 캐시 무효화 — 인증 상태처럼 모든 페이지에 영향이 있을 때만 사용 */
export function revalidateAll() {
  revalidatePath("/", "layout");
}

/** 영향받은 경로만 무효화 (양 로케일). 예: revalidateLocalized("/dashboard") */
export function revalidateLocalized(...paths: string[]) {
  for (const path of paths) {
    revalidatePath(`/ko${path}`);
    revalidatePath(`/en${path}`);
  }
}

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/ko/login");
  return { supabase, user };
}

export async function requireAdmin() {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/ko/dashboard");
  return { supabase, user };
}

/** 공통 저장 결과 (useActionState 피드백용) */
export interface SaveState {
  ok?: boolean;
  /** "invalid" | "forbidden" | "failed" 등 */
  error?: string;
}

/** FormData 문자열 정규화 (빈 문자열 → undefined) */
export function str(v: FormDataEntryValue | null): string | undefined {
  const s = String(v ?? "").trim();
  return s === "" ? undefined : s;
}
