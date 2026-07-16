import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { OAuthButtons } from "./OAuthButtons";
import { EmailLoginForm } from "./EmailLoginForm";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "login" });
  return { title: t("title") };
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { error } = await searchParams;
  const t = await getTranslations("login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(`/${locale}/dashboard`);

  return (
    <div className="mx-auto max-w-md px-4 py-20 sm:px-6">
      <div className="doc-card p-8">
        <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
        <p className="mt-3 text-[var(--color-ink-soft)]">{t("desc")}</p>

        {error && (
          <p role="alert" className="mt-4 border-[1.5px] border-[var(--color-crit)] bg-[var(--color-crit-tint)] px-3 py-2 text-sm font-medium text-[var(--color-crit)]">
            {error === "confirm" ? t("errorConfirm") : t("error")}
          </p>
        )}

        <OAuthButtons locale={locale} googleLabel={t("withGoogle")} githubLabel={t("withGithub")} />

        {/* 이메일 매직링크 로그인/가입 */}
        <div className="mt-6 flex items-center gap-3 text-xs text-[var(--color-ink-faint)]" aria-hidden="true">
          <span className="h-px flex-1 bg-[var(--color-line)]" />
          {t("or")}
          <span className="h-px flex-1 bg-[var(--color-line)]" />
        </div>
        <EmailLoginForm
          locale={locale}
          labels={{
            tabSignIn: t("tabSignIn"),
            tabSignUp: t("tabSignUp"),
            emailLabel: t("emailLabel"),
            emailPlaceholder: t("emailPlaceholder"),
            passwordLabel: t("passwordLabel"),
            passwordPlaceholder: t("passwordPlaceholder"),
            passwordConfirmLabel: t("passwordConfirmLabel"),
            signIn: t("signIn"),
            signUp: t("signUp"),
            forgot: t("forgot"),
            forgotTitle: t("forgotTitle"),
            forgotDesc: t("forgotDesc"),
            sendReset: t("sendReset"),
            backToSignIn: t("backToSignIn"),
            working: t("working"),
            signUpSent: t("signUpSent"),
            resetSent: t("resetSent"),
            errPasswordMismatch: t("errPasswordMismatch"),
            errPasswordShort: t("errPasswordShort"),
            errInvalidCredentials: t("errInvalidCredentials"),
            errNotConfirmed: t("errNotConfirmed"),
            errExists: t("errExists"),
            errGeneric: t("errGeneric"),
          }}
        />

        <p className="mt-6 text-xs text-[var(--color-ink-faint)]">
          {t("privacy")}{" "}
          <Link href="/privacy" className="font-semibold underline underline-offset-2">
            {t("privacyLink")}
          </Link>
        </p>
      </div>
    </div>
  );
}
