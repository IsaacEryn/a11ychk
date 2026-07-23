import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ConnectClient } from "./ConnectClient";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "extension" });
  return { title: t("title"), robots: { index: false } };
}

export default async function ExtensionConnectPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("extension");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/extension/connect`);

  // 크롬 웹스토어 게시 항목 (A11y Check 확장, 게시 완료)
  const storeUrl = "https://chromewebstore.google.com/detail/a11y-check/ldldalfanbiampibejfhbdcjdlkcaoag";

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <p className="mt-3 text-[var(--color-ink-soft)]">{t("desc")}</p>

      <a
        href={storeUrl}
        target="_blank"
        rel="noopener"
        className="mt-6 inline-block rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
      >
        {t("installButton")} ↗
      </a>

      <ol className="mt-6 list-decimal space-y-2 pl-5 text-[var(--color-ink-soft)]">
        <li>{t("step1")}</li>
        <li>{t("step2")}</li>
        <li>{t("step3")}</li>
      </ol>

      <ConnectClient
        email={user.email ?? ""}
        labels={{
          waiting: t("waiting"),
          connected: t("connected"),
          notInstalled: t("notInstalled"),
          account: t("account"),
        }}
      />
    </div>
  );
}
