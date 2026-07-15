import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccessCheckClient } from "./AccessCheckClient";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "accessCheck" });
  return { title: t("title") };
}

export default async function AccessCheckPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("accessCheck");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  const guides = ["robots", "waf", "extension", "staging"] as const;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-[var(--color-ink-soft)]">{t("desc")}</p>

      <AccessCheckClient />

      {/* ─── 봇 차단 대응 가이드 ─── */}
      <section aria-labelledby="guide-heading" className="mt-12">
        <h2 id="guide-heading" className="font-display text-2xl font-bold">
          {t("guideTitle")}
        </h2>
        <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("guideDesc")}</p>
        <ol className="mt-5 space-y-4">
          {guides.map((key, i) => (
            <li key={key} className="doc-card p-5">
              <h3 className="font-display text-lg font-bold">
                <span className="mr-2 text-[var(--color-seal)]" aria-hidden="true">
                  {i + 1}.
                </span>
                {t(`guide.${key}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">{t(`guide.${key}.desc`)}</p>
              {key === "robots" && (
                <pre tabIndex={0} className="mt-3 overflow-x-auto rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)] p-3 text-xs">
                  <code>{`# robots.txt에 추가\nUser-agent: a11ychk-bot\nAllow: /`}</code>
                </pre>
              )}
              {key === "waf" && (
                <pre tabIndex={0} className="mt-3 overflow-x-auto rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)] p-3 text-xs">
                  <code>{`User-Agent 허용 규칙에 추가: a11ychk-bot\n(전체 UA: Mozilla/5.0 (compatible; a11ychk-bot/0.1; +https://a11ychk.com/bot))`}</code>
                </pre>
              )}
              {key === "extension" && (
                <p className="mt-3 text-sm">
                  <Link href="/extension/connect" className="font-bold text-[var(--color-seal)] underline underline-offset-4">
                    {t("guide.extension.cta")}
                  </Link>
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
