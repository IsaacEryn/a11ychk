/** 서버 액션 공통 헬퍼 — "use server" 파일은 async 함수만 export 가능하므로 별도 모듈에 둔다 */
import "server-only";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkAdmin } from "@/lib/adminGuard";
import { adminBase } from "@/lib/adminSlug";
import { localeFromPathname } from "@/i18n/routing";

/** 전 경로 캐시 무효화 — 인증 상태처럼 모든 페이지에 영향이 있을 때만 사용 */
export function revalidateAll() {
  revalidatePath("/", "layout");
}

/**
 * 영향받은 경로만 무효화 (양 로케일). 예: revalidateLocalized("/dashboard")
 *
 * 관리자 경로는 한 번 더 무효화한다. 프록시가 `/{locale}/{slug}/**`를 내부
 * `/{locale}/admin/**`로 rewrite하므로 두 경로가 가리키는 화면은 같지만, 클라이언트
 * 라우터의 캐시 키는 **브라우저에 보이는 슬러그 경로**다. 내부 경로만 무효화하면
 * 서버 액션이 끝난 뒤 라우터가 갱신할 대상을 찾지 못해 트랜지션이 닫히지 않고,
 * useActionState의 pending이 영영 풀리지 않는다 — 버튼이 "처리 중"에 머문 채
 * 성공/실패 표시가 나오지 않는 증상으로 보인다.
 *
 * 실측(2026-08-12, 프로덕션): 관리자 폼은 네트워크가 600ms 안에 모두 끝났는데도
 * pending이 1분 넘게 유지됐고, 같은 useActionState + revalidatePath 조합인
 * 마이페이지 닉네임 저장은 정상 동작했다. rewrite가 걸린 경로에서만 나타난다.
 */
export function revalidateLocalized(...paths: string[]) {
  const base = adminBase(); // 슬러그 미설정이면 "/admin" — 이때는 추가 무효화가 불필요
  for (const path of paths) {
    for (const locale of ["ko", "en"]) {
      revalidatePath(`/${locale}${path}`);
      if (base !== "/admin" && path.startsWith("/admin")) {
        revalidatePath(`/${locale}${base}${path.slice("/admin".length)}`);
      }
    }
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
  return localeFromPathname((await headers()).get("x-pathname") ?? "");
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
