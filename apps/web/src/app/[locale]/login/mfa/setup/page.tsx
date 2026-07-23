import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sanitizeNextPath } from "@/lib/safeRedirect";
import { adminBasePath } from "@/lib/adminSlug";
import { MfaSetupForm } from "./MfaSetupForm";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "login.mfa" });
  return { title: t("setupTitle"), robots: { index: false } };
}

/**
 * 관리자 2단계 인증 등록 — TOTP factor를 등록해야 관리자 페이지에 접근할 수 있다.
 * admin 세그먼트 밖(등록 전 AAL2가 불가능한 닭-달걀 방지). 일반 회원 진입 불가.
 */
export default async function MfaSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { next: rawNext } = await searchParams;
  const next = sanitizeNextPath(rawNext, adminBasePath(locale));
  const t = await getTranslations("login.mfa");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(next)}`);
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") redirect(`/${locale}/dashboard`);
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") redirect(next);
  // 이미 등록돼 있으면 챌린지로 (등록 페이지는 미등록 관리자 전용)
  if (aal?.nextLevel === "aal2") redirect(`/${locale}/login/mfa?next=${encodeURIComponent(next)}`);

  return (
    <div className="mx-auto max-w-md px-4 py-20 sm:px-6">
      <div className="doc-card p-8">
        <h1 className="font-display text-2xl font-bold">{t("setupTitle")}</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{t("setupDesc")}</p>
        <MfaSetupForm
          next={next}
          labels={{
            scanQr: t("scanQr"),
            secretLabel: t("secretLabel"),
            codeLabel: t("codeLabel"),
            verify: t("verify"),
            working: t("working"),
            errInvalidCode: t("errInvalidCode"),
            errGeneric: t("errGeneric"),
          }}
        />
      </div>
    </div>
  );
}
