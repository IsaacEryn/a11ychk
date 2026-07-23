import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAnnouncements } from "@/lib/appSettings";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "notices" });
  return { title: t("title") };
}

/** 서비스 공지 — 약관의 "서비스 내 공지" 조항을 구현하는 공식 채널 (전체 이력 표시) */
export default async function NoticesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("notices");
  const format = await getFormatter();
  const lang = locale === "en" ? "en" : "ko";

  const items = await getAnnouncements(createAdminClient()).catch(() => []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-[var(--color-ink-soft)]">{t("intro")}</p>

      {items.length === 0 ? (
        <p className="mt-8 border-[1.5px] border-dashed border-[var(--color-line)] p-6 text-sm text-[var(--color-ink-faint)]">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-8 space-y-6">
          {items.map((n) => (
            <li key={n.id} className="doc-card p-6">
              <article aria-labelledby={`notice-${n.id}`}>
                <p className="text-sm tabular-nums text-[var(--color-ink-faint)]">
                  {format.dateTime(new Date(n.date), { dateStyle: "long" })}
                </p>
                <h2 id={`notice-${n.id}`} className="font-display mt-1 text-xl font-bold">
                  {n[lang].title}
                </h2>
                <div className="mt-3 space-y-2 leading-relaxed text-[var(--color-ink-soft)]">
                  {n[lang].body.split(/\n+/).map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
