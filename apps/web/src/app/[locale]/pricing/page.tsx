import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getBillingFlags } from "@/lib/appSettings";
import { billingMode } from "@/lib/billing/config";
import { isMissingTable } from "@/lib/billing/dbErrors";
import { loadViewer } from "@/lib/billing/viewer";
import { canCheckout, canSeePrices, priceLivemode } from "@/lib/billing/visibility";
import { logAppError } from "@/lib/logs";
import { TIERS } from "@/lib/quota";
import { localeAlternates } from "@/lib/seo/alternates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pricing" });
  return {
    alternates: localeAlternates(locale, "/pricing"),
    title: t("title"),
    description: t("desc"),
  };
}

interface ShownPrice {
  id: string;
  plan_code: string;
  interval: "month" | "year";
  amount: number;
  currency: "KRW";
}

/**
 * 진열할 가격 — 토스·원화·지금 모드의 활성 가격(billing_prices는 service role 전용이라 관리자 클라이언트로 읽는다).
 * 0041 미적용(테이블 없음)이면 조용히 가격 없음, 그 밖의 오류는 기록하고 가격 없음 — 요금제 페이지는 늘 열린다.
 */
async function loadShownPrices(livemode: boolean): Promise<ShownPrice[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_prices")
    .select("id, plan_code, interval, amount, currency")
    .eq("provider", "toss")
    .eq("currency", "KRW")
    .eq("livemode", livemode)
    .eq("active", true)
    .in("plan_code", ["pro", "enterprise"]);
  if (error) {
    if (!isMissingTable(error)) await logAppError(admin, `pricing price lookup failed: ${error.message}`, { path: "pricing" });
    return [];
  }
  return ((data as ShownPrice[] | null) ?? []).sort((a, b) => (a.interval === b.interval ? 0 : a.interval === "month" ? -1 : 1));
}

/**
 * 요금제 안내 — 한도 수치는 lib/quota.ts TIERS 단일 소스에서 렌더해 코드와 안내가 어긋나지 않게 한다.
 * 유료 등급은 결제 공개 범위(lib/billing/visibility.ts)가 허락하고 그 등급의 활성 가격이 있을 때만 가격(부가세 포함)을
 * 보이고, 결제까지 열렸으면 주기별 구독 링크를 단다(비로그인이면 로그인을 거쳐 결제 확인 화면으로). 그 밖에는
 * "준비 중"과 도입 문의로 투명하게 예고만 한다(결제가 열리지 않은 상태에서 판매 문구 금지).
 */
export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pricing");
  const format = await getFormatter();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const mode = billingMode();
  const [viewer, flags] = await Promise.all([loadViewer(supabase, user?.id ?? null), getBillingFlags(supabase)]);
  const showPrices = canSeePrices(mode, flags, viewer);
  const checkoutOpen = canCheckout(mode, flags, viewer);
  const prices = showPrices ? await loadShownPrices(priceLivemode(mode)) : [];

  /** 결제 확인 화면 — 비로그인이면 로그인 뒤 그 화면으로 돌아온다 */
  const subscribeHref = (priceId: string) => {
    const checkoutPath = `/billing/checkout?price=${priceId}`;
    return user ? checkoutPath : `/login?next=${encodeURIComponent(`/${locale}${checkoutPath}`)}`;
  };

  const tiers = (["free", "pro", "enterprise"] as const).map((id) => {
    const tierPrices = prices.filter((p) => p.plan_code === id);
    return {
      id,
      plan: TIERS[id],
      free: id === "free",
      prices: tierPrices,
      purchasable: checkoutOpen && tierPrices.length > 0,
    };
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <p className="text-sm font-bold uppercase tracking-widest text-[var(--color-seal)]">{t("eyebrow")}</p>
      <h1 className="font-display mt-1 text-3xl font-bold">{t("title")}</h1>
      <p className="mt-2 max-w-2xl leading-relaxed text-[var(--color-ink-soft)]">{t("desc")}</p>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {tiers.map(({ id, plan, free, prices: tierPrices, purchasable }) => (
          <section
            key={id}
            aria-labelledby={`tier-${id}`}
            className={`doc-card flex flex-col p-6 ${free || purchasable ? "" : "opacity-90"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id={`tier-${id}`} className="font-display text-xl font-bold">
                {t(`tiers.${id}.name`)}
              </h2>
              {free ? (
                <span className="rounded-full bg-[var(--color-seal-tint)] px-2.5 py-0.5 text-xs font-bold text-[var(--color-seal)]">
                  {t("badgeFree")}
                </span>
              ) : purchasable ? null : (
                <span className="rounded-full border-[1.5px] border-[var(--color-line)] px-2.5 py-0.5 text-xs font-bold text-[var(--color-ink-faint)]">
                  {t("badgeSoon")}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t(`tiers.${id}.desc`)}</p>
            {tierPrices.length > 0 && (
              <ul className="mt-3 space-y-1">
                {tierPrices.map((p) => (
                  <li key={p.id}>
                    <span className="font-display text-2xl font-bold">
                      {t(`price.${p.interval}`, { amount: format.number(p.amount, { style: "currency", currency: p.currency }) })}
                    </span>{" "}
                    <span className="text-xs text-[var(--color-ink-soft)]">{t("price.vat")}</span>
                  </li>
                ))}
              </ul>
            )}
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              <li>· {t("limits.daily", { n: plan.daily })}</li>
              <li>· {t("limits.weekly", { n: plan.weekly })}</li>
              <li>· {t("limits.monthly", { n: plan.monthly })}</li>
              <li>· {t("limits.verify", { n: plan.verifiedDomains })}</li>
              <li>· {t("limits.pages", { n: plan.sampleUnverified })}</li>
              <li>· {t("limits.pagesVerified", { n: plan.sampleVerified })}</li>
              <li>· {t(`tiers.${id}.extra`)}</li>
            </ul>
            <div className="mt-5 flex flex-wrap gap-2">
              {free ? (
                <Link
                  href="/dashboard"
                  className="inline-block rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
                >
                  {t("ctaFree")}
                </Link>
              ) : purchasable ? (
                tierPrices.map((p) => (
                  <Link
                    key={p.id}
                    href={subscribeHref(p.id)}
                    className="inline-block rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
                  >
                    {t(`ctaSubscribe.${p.interval}`)}
                    {/* 링크 이름이 플랜마다 달라야 한다(WCAG 2.4.4) — 보이는 문구는 그대로 두고 플랜 이름을 덧붙인다 */}
                    <span className="sr-only"> — {t(`tiers.${id}.name`)}</span>
                  </Link>
                ))
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

      {/* 결제가 열린 유료 플랜이 있으면 "시행 전" 안내 대신 구독 안내 */}
      <p className="mt-8 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-faint)]">
        {tiers.some((tier) => tier.purchasable) ? t("noteSubscribable") : t("note")}
      </p>
    </div>
  );
}
