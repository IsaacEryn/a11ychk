import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PLANS, MAX_PAGES_PER_SCAN, DOMAIN_VERIFY_LIMITS } from "@/lib/quota";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pricing" });
  return { title: t("title"), description: t("desc") };
}

/**
 * 요금제 안내 — 현재는 전 기능 무료(요금제 시행 전). pro/enterprise는 "준비 중"으로
 * 투명하게 예고만 한다(결제 인프라 미도입 상태에서 판매 문구 금지). 한도 수치는
 * lib/quota.ts PLANS 단일 소스에서 렌더해 코드와 안내가 어긋나지 않게 한다.
 */
export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pricing");

  const tiers = (["free", "pro", "enterprise"] as const).map((id) => ({
    id,
    plan: PLANS[id],
    available: id === "free",
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <p className="text-sm font-bold uppercase tracking-widest text-[var(--color-seal)]">{t("eyebrow")}</p>
      <h1 className="font-display mt-1 text-3xl font-bold">{t("title")}</h1>
      <p className="mt-2 max-w-2xl leading-relaxed text-[var(--color-ink-soft)]">{t("desc")}</p>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {tiers.map(({ id, plan, available }) => (
          <section key={id} aria-labelledby={`tier-${id}`} className={`doc-card flex flex-col p-6 ${available ? "" : "opacity-90"}`}>
            <div className="flex items-center justify-between gap-2">
              <h2 id={`tier-${id}`} className="font-display text-xl font-bold">
                {t(`tiers.${id}.name`)}
              </h2>
              {available ? (
                <span className="rounded-full bg-[var(--color-seal-tint)] px-2.5 py-0.5 text-xs font-bold text-[var(--color-seal)]">
                  {t("badgeFree")}
                </span>
              ) : (
                <span className="rounded-full border-[1.5px] border-[var(--color-line)] px-2.5 py-0.5 text-xs font-bold text-[var(--color-ink-faint)]">
                  {t("badgeSoon")}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t(`tiers.${id}.desc`)}</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              <li>· {t("limits.daily", { n: plan.daily })}</li>
              <li>· {t("limits.weekly", { n: plan.weekly })}</li>
              <li>· {t("limits.monthly", { n: plan.monthly })}</li>
              <li>· {t("limits.verify", { n: DOMAIN_VERIFY_LIMITS[id] })}</li>
              <li>· {t("limits.pages", { n: Math.min(plan.sampleSize, MAX_PAGES_PER_SCAN) })}</li>
              <li>· {t(`tiers.${id}.extra`)}</li>
            </ul>
            <div className="mt-5">
              {available ? (
                <Link
                  href="/dashboard"
                  className="inline-block rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
                >
                  {t("ctaFree")}
                </Link>
              ) : (
                <Link
                  href="/inquiries"
                  className="inline-block rounded border-[1.5px] border-[var(--color-ink)] px-5 py-2.5 font-bold hover:bg-[var(--color-paper-warm)]"
                >
                  {t("ctaContact")}
                </Link>
              )}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-8 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-faint)]">{t("note")}</p>
    </div>
  );
}
