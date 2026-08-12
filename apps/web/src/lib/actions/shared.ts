/** 서버 액션 공통 헬퍼 — "use server" 파일은 async 함수만 export 가능하므로 별도 모듈에 둔다 */
import "server-only";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkAdmin } from "@/lib/adminGuard";
import { localeFromPathname } from "@/i18n/routing";

/** 전 경로 캐시 무효화 — 인증 상태처럼 모든 페이지에 영향이 있을 때만 사용 */
export function revalidateAll() {
  revalidatePath("/", "layout");
}

/**
 * 영향받은 경로만 무효화 (양 로케일). 예: revalidateLocalized("/dashboard")
 *
 * **관리자 경로(`/admin**`)는 무효화하지 않는다.** 두 가지 이유가 겹친다.
 *
 * 첫째, 관리자 페이지는 전부 요청마다 렌더된다(requireAdmin이 쿠키를 읽어 동적
 * 렌더가 강제되고, 데이터도 매번 Supabase에서 읽는다). 무효화할 캐시가 없다.
 *
 * 둘째, 무효화가 실제로 해롭다. 프록시가 `/{locale}/{slug}/**`를 내부
 * `/{locale}/admin/**`로 rewrite하는데 클라이언트 라우터의 캐시 키는 브라우저에
 * 보이는 슬러그 경로다. 서버가 "이 경로를 갱신하라"고 알려도 라우터가 대상을
 * 찾지 못해 트랜지션이 닫히지 않고, useActionState의 pending이 풀리지 않는다.
 * 버튼이 "처리 중"에 머문 채 성공 표시가 나오지 않는 증상이다.
 *
 * 실측(2026-08-12, 프로덕션): 네트워크는 600ms 안에 끝났는데 pending이 1분 넘게
 * 유지됐고, 같은 조합을 쓰는 마이페이지 닉네임 저장은 정상이었다. 바깥 경로를
 * 함께 무효화해 보니 페이지 로드 후 첫 제출만 풀리고 두 번째부터 다시 멈췄다.
 *
 * 관리자 화면의 갱신은 클라이언트에서 한다 — `useAdminAction`이 성공 시
 * `router.refresh()`를 부른다. refresh는 브라우저 URL 기준이라 rewrite와 무관하다.
 *
 * 호출부는 영향 범위를 그대로 적어 둔다(예: `("/admin/users", "/dashboard")`).
 * 어디가 바뀌는지 읽히는 편이 낫고, 관리자 경로만 여기서 걸러진다.
 */
export function revalidateLocalized(...paths: string[]) {
  for (const path of paths) {
    if (path === "/admin" || path.startsWith("/admin/")) continue;
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
