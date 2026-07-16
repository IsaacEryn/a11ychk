import { getTranslations, setRequestLocale } from "next-intl/server";
import { ResetForm } from "./ResetForm";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "reset" });
  return { title: t("title"), robots: { index: false } };
}

export default async function ResetPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("reset");

  return (
    <div className="mx-auto max-w-md px-4 py-20 sm:px-6">
      <div className="doc-card p-8">
        <h1 className="font-display text-2xl font-bold">{t("title")}</h1>
        <p className="mt-2 mb-4 text-sm text-[var(--color-ink-soft)]">{t("desc")}</p>
        <ResetForm
          locale={locale}
          labels={{
            passwordLabel: t("passwordLabel"),
            passwordConfirmLabel: t("passwordConfirmLabel"),
            passwordPlaceholder: t("passwordPlaceholder"),
            submit: t("submit"),
            working: t("working"),
            done: t("done"),
            goDashboard: t("goDashboard"),
            noSession: t("noSession"),
            errShort: t("errShort"),
            errMismatch: t("errMismatch"),
            errGeneric: t("errGeneric"),
          }}
        />
      </div>
    </div>
  );
}
