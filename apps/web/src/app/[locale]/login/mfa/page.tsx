import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sanitizeNextPath } from "@/lib/safeRedirect";
import { adminBasePath } from "@/lib/adminSlug";
import { MfaChallengeForm } from "./MfaChallengeForm";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "login.mfa" });
  return { title: t("challengeTitle"), robots: { index: false } };
}

/**
 * 관리자 2단계 인증 챌린지 — 로그인(AAL1) 후 TOTP 6자리로 AAL2 세션 승격.
 * admin 세그먼트 밖(닭-달걀 방지). 일반 회원은 진입 자체가 불가(dashboard로).
 */
export default async function MfaChallengePage({
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
  if (aal?.nextLevel !== "aal2") redirect(`/${locale}/login/mfa/setup?next=${encodeURIComponent(next)}`);
  if (aal.currentLevel === "aal2") redirect(next);

  return (
    <div className="mx-auto max-w-md px-4 py-20 sm:px-6">
      <div className="doc-card p-8">
        <h1 className="font-display text-2xl font-bold">{t("challengeTitle")}</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{t("challengeDesc")}</p>
        <MfaChallengeForm
          next={next}
          labels={{
            codeLabel: t("codeLabel"),
            verify: t("verify"),
            working: t("working"),
            reissue: t("reissue"),
            errInvalidCode: t("errInvalidCode"),
            errGeneric: t("errGeneric"),
          }}
        />
      </div>
    </div>
  );
}
