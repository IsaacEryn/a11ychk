import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Link } from "@/i18n/navigation";
import { Notice } from "@/components/Notice";
import { getBillingFlags } from "@/lib/appSettings";
import { checkoutTerms } from "@/lib/billing/checkout";
import { billingMode, rowLivemode } from "@/lib/billing/config";
import { isMissingTable } from "@/lib/billing/dbErrors";
import { planNameFor } from "@/lib/billing/flows/subscribe";
import type { PriceRow } from "@/lib/billing/types";
import { loadViewer } from "@/lib/billing/viewer";
import { canCheckout, priceLivemode } from "@/lib/billing/visibility";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CheckoutForm } from "./CheckoutForm";
import { FocusOnMount } from "./FocusOnMount";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "billing.checkout" });
  // 로그인·결제 모드 게이트 — 색인하지 않는다(robots.txt도 /billing을 막는다)
  return { title: t("title"), robots: { index: false } };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 결제창에서 돌아와 보여 줄 수 있는 오류 — 이 목록 밖의 값은 무시한다(쿼리 문자열을 화면에 그대로 싣지 않는다) */
const RETURN_ERRORS = [
  "canceled",
  "cardRejected",
  "failed",
  "expired",
  "hasActive",
  "duplicateRefunded",
  "customerMismatch",
  "priceInactive",
  "notConfigured",
] as const;
type ReturnError = (typeof RETURN_ERRORS)[number];

const PRICE_COLS = "id, plan_code, provider, currency, interval, amount, livemode, active";

/** 가격 행 — 0041 미적용(테이블 없음)이면 없는 가격으로 본다. 그 밖의 오류는 던진다(오류 화면) */
async function loadPrice(admin: SupabaseClient, id: string): Promise<PriceRow | null> {
  const { data, error } = await admin.from("billing_prices").select(PRICE_COLS).eq("id", id).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(`billing checkout price lookup failed: ${error.message}`);
  }
  return (data as PriceRow | null) ?? null;
}

/** 지금 시각 기준의 조건 — 이 화면은 요청마다 렌더된다(로그인 쿠키). 동의 스냅샷은 제출 시각으로 다시 계산한다 */
const termsAsOfNow = (price: PriceRow) => checkoutTerms(price, Date.now());

async function hasLiveSubscription(admin: SupabaseClient, userId: string, livemode: boolean): Promise<boolean> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .eq("livemode", livemode)
    .in("status", ["active", "past_due"])
    .limit(1);
  if (error) {
    if (isMissingTable(error)) return false;
    throw new Error(`billing checkout subscription lookup failed: ${error.message}`);
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * 정기결제 최종 확인 화면 — 카드를 등록하기 전에 플랜·부가세 포함 금액·주기·오늘 첫 결제·다음 결제일·자동 갱신·해지 방법을
 * 보여 주고, 미리 체크하지 않은 필수 동의를 받는다(CheckoutForm). 금액·날짜는 서버가 가격 행으로 계산한다.
 * 결제 모드가 꺼졌거나 결제할 수 없는 계정·없는 가격이면 404, 비로그인이면 로그인 뒤 이 주소로 돌아온다.
 */
export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ price?: string | string[]; error?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;

  const mode = billingMode();
  const livemode = rowLivemode(mode);
  if (livemode === null) notFound();

  const priceId = typeof sp.price === "string" && UUID_RE.test(sp.price) ? sp.price.toLowerCase() : null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const here = `/${locale}/billing/checkout${priceId ? `?price=${priceId}` : ""}`;
    redirect(`/${locale}/login?next=${encodeURIComponent(here)}`);
  }

  const [viewer, flags] = await Promise.all([loadViewer(supabase, user.id), getBillingFlags(supabase)]);
  if (!canCheckout(mode, flags, viewer) || !priceId) notFound();

  const admin = createAdminClient();
  const price = await loadPrice(admin, priceId);
  if (!price || price.provider !== "toss" || price.currency !== "KRW" || price.livemode !== priceLivemode(mode)) notFound();
  const subscribed = await hasLiveSubscription(admin, user.id, livemode);

  const t = await getTranslations("billing.checkout");
  const format = await getFormatter();
  const returnError = typeof sp.error === "string" && (RETURN_ERRORS as readonly string[]).includes(sp.error) ? (sp.error as ReturnError) : null;

  const terms = termsAsOfNow(price);
  const money = format.number(terms.amount, { style: "currency", currency: terms.currency });
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "long" });

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <p className="text-sm font-bold uppercase tracking-widest text-[var(--color-seal)]">{t("eyebrow")}</p>
      <h1 className="font-display mt-1 text-3xl font-bold">{t("title")}</h1>
      <p className="mt-2 leading-relaxed text-[var(--color-ink-soft)]">{t("desc")}</p>

      {mode === "test" && <Notice variant="warn" live={false} className="mt-6" title={t("testMode")} />}
      {/* 결제창에서 돌아온 결과 — 화면에 들어오자마자 포커스를 옮겨 먼저 읽히게 한다 */}
      {returnError && (
        <FocusOnMount className="mt-6">
          <Notice variant="error" title={t(`returnErrors.${returnError}`)} />
        </FocusOnMount>
      )}

      {subscribed ? (
        <Notice variant="info" live={false} className="mt-6" title={t("subscribedTitle")}>
          <p>{t("subscribedBody")}</p>
          <p className="mt-2">
            <Link href="/mypage/billing" className="font-semibold text-[var(--color-seal)] underline underline-offset-2">
              {t("manageLink")}
            </Link>
          </p>
        </Notice>
      ) : !price.active ? (
        <Notice variant="info" live={false} className="mt-6" title={t("inactiveTitle")}>
          <p>
            <Link href="/pricing" className="font-semibold text-[var(--color-seal)] underline underline-offset-2">
              {t("pricingLink")}
            </Link>
          </p>
        </Notice>
      ) : (
        <>
          <section aria-labelledby="checkout-summary" className="doc-card mt-6 p-6">
            <h2 id="checkout-summary" className="font-display text-xl font-bold">
              {t("summaryTitle")}
            </h2>
            <dl className="mt-4 divide-y divide-[var(--color-line)] text-sm">
              <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-2.5">
                <dt className="font-semibold">{t("plan")}</dt>
                <dd>{planNameFor(terms.planCode)}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-2.5">
                <dt className="font-semibold">{t("amount")}</dt>
                <dd>{t("amountValue", { amount: money })}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-2.5">
                <dt className="font-semibold">{t("cycle")}</dt>
                <dd>{t(`cycleValue.${terms.interval}`)}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-2.5">
                <dt className="font-semibold">{t("firstCharge")}</dt>
                <dd>{t("firstChargeValue", { date: day(terms.firstChargeAt), amount: money })}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-2.5">
                <dt className="font-semibold">{t("period")}</dt>
                <dd>{t("periodValue", { start: day(terms.firstChargeAt), end: day(terms.periodEnd) })}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-2.5">
                <dt className="font-semibold">{t("nextCharge")}</dt>
                {/* 갱신 결제는 기간 끝 하루 전부터 나간다 — 결제 예정 안내 메일과 같은 날짜 */}
                <dd>{day(terms.nextChargeAt)}</dd>
              </div>
            </dl>
            <ul className="mt-5 list-disc space-y-2 pl-5 text-sm leading-relaxed">
              <li>{t("renewal")}</li>
              <li>{t("nextChargeHint")}</li>
              <li>{t("cancelHow")}</li>
            </ul>
          </section>
          <CheckoutForm priceId={price.id} />
        </>
      )}
    </div>
  );
}
