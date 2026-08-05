/** 서버 액션 공통 헬퍼 — "use server" 파일은 async 함수만 export 가능하므로 별도 모듈에 둔다 */
import "server-only";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkAdmin } from "@/lib/adminGuard";

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

/** 요청 경로에서 로케일 추정 — 서버 액션은 세그먼트 파라미터를 받지 못한다 */
async function actionLocale(): Promise<string> {
  const path = (await headers()).get("x-pathname") ?? "";
  return path.startsWith("/en/") || path === "/en" ? "en" : "ko";
}

/**
 * 서버 액션용 관리자 가드 — 판정은 페이지 가드와 같은 사슬(adminGuard.checkAdmin)을 쓰고
 * 리다이렉트 목적지만 액션 맥락에 맞춘다. 서버 액션은 페이지 가드를 거치지 않으므로
 * 여기서 다시 확인해야 우회되지 않는다.
 */
export async function requireAdmin() {
  const check = await checkAdmin();
  if (!check.ok) {
    const locale = await actionLocale();
    switch (check.reason) {
      case "unauthenticated":
        redirect(`/${locale}/login`);
      case "not-admin":
        redirect(`/${locale}/dashboard`);
      case "mfa-setup":
        redirect(`/${locale}/login/mfa/setup`);
      case "mfa-challenge":
        redirect(`/${locale}/login/mfa`);
      case "idle-expired":
        redirect(`/auth/admin-timeout?locale=${locale}`);
    }
  }
  return requireUser();
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
