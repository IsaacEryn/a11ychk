import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { FocusOnMount } from "@/components/FocusOnMount";
import { Notice } from "@/components/Notice";
import { getBillingFlags } from "@/lib/appSettings";
import { UUID_RE, checkoutTerms, returnErrorOf } from "@/lib/billing/checkout";
import { billingMode, rowLivemode } from "@/lib/billing/config";
import { isMissingTable } from "@/lib/billing/dbErrors";
import { planNameFor } from "@/lib/billing/flows/subscribe";
import { amountInMajorUnits } from "@/lib/billing/price";
import { createSupabaseBillingStore } from "@/lib/billing/store";
import type { PriceRow } from "@/lib/billing/types";
import { loadViewer } from "@/lib/billing/viewer";
import { canCheckout, priceLivemode } from "@/lib/billing/visibility";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CheckoutForm } from "./CheckoutForm";
import { MorCheckoutForm } from "./MorCheckoutForm";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "billing.checkout" });
  // 로그인·결제 모드 게이트 — 색인하지 않는다(robots.txt도 /billing을 막는다)
  return { title: t("title"), robots: { index: false } };
}

/** 지금 시각 기준의 조건 — 이 화면은 요청마다 렌더된다(로그인 쿠키). 동의 스냅샷은 제출 시각으로 다시 계산한다 */
const termsAsOfNow = (price: PriceRow) => checkoutTerms(price, Date.now());

/** 이 화면이 다루는 가격 — 토스(원화) 또는 판매 대행 Polar(USD). 결제사와 통화가 어긋난 행은 없는 것으로 본다 */
const isCheckoutPrice = (price: PriceRow) =>
  (price.provider === "toss" && price.currency === "KRW") || (price.provider === "mor" && price.currency === "USD");

const ROW = "flex flex-wrap justify-between gap-x-6 gap-y-1 py-2.5";

/** 저장소 읽기 — 0041 미적용(테이블 없음)이면 없는 것으로 본다. 그 밖의 오류는 던진다(오류 화면) */
async function orMissing<T>(read: Promise<T>, missing: T): Promise<T> {
  try {
    return await read;
  } catch (e) {
    if (isMissingTable(e)) return missing;
    throw e;
  }
}

/**
 * 정기결제 최종 확인 화면 — 결제창으로 가기 전에 조건을 보여 주고 미리 체크하지 않은 필수 동의를 받는다. 금액·날짜는 서버가 가격 행으로 계산한다.
 * - 토스(국내, 원화): 플랜·부가세 포함 금액·주기·오늘 첫 결제·이용 기간·다음 결제일(기간 끝 하루 전)·자동 갱신·해지 방법(CheckoutForm).
 * - 판매 대행 Polar(해외, USD): 플랜·세금 전 금액("+ 적용되는 세금")·주기·오늘 첫 결제·주기마다 자동 갱신·해지 방법(Polar 고객 포털)·
 *   판매 대행 고지(MorCheckoutForm). 다음 결제일은 적지 않는다 — Polar가 결제를 마친 시각으로 기간을 정하고(UTC·자체 월 계산),
 *   이 화면은 한국 시간으로 날짜를 쓰므로 하루가 어긋날 수 있다. 정확한 날짜는 Polar 영수증·고객 포털에 있다.
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

  // 결제 흐름과 같은 저장소 메서드로 읽는다(가격 행·진행 중 구독 판정이 콜백과 어긋나지 않게)
  const store = createSupabaseBillingStore(createAdminClient());
  const price = await orMissing(store.getPrice(priceId), null);
  if (!price || !isCheckoutPrice(price) || price.livemode !== priceLivemode(mode)) notFound();
  const mor = price.provider === "mor";
  // Polar 상품 id가 없는 MoR 가격은 결제창을 열 수 없다 — 판매하지 않는 가격으로 안내한다
  const sellable = price.active && (!mor || price.external_price_id !== null);
  const subscribed = (await orMissing(store.getLiveSubscription(user.id, livemode), null)) !== null;

  const t = await getTranslations("billing.checkout");
  const format = await getFormatter();
  const returnError = returnErrorOf(sp.error);

  const terms = termsAsOfNow(price);
  const money = format.number(amountInMajorUnits(terms.amount, terms.currency), { style: "currency", currency: terms.currency });
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "long" });

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <p className="text-sm font-bold uppercase tracking-widest text-[var(--color-seal)]">{t("eyebrow")}</p>
      <h1 className="font-display mt-1 text-3xl font-bold">{t("title")}</h1>
      <p className="mt-2 leading-relaxed text-[var(--color-ink-soft)]">{t(mor ? "mor.desc" : "desc")}</p>

      {mode === "test" && <Notice variant="warn" live={false} className="mt-6" title={t("testMode")} />}
      {/* 결제창에서 돌아온 결과 — 화면에 들어오자마자 포커스를 옮겨 먼저 읽히게 한다 */}
      {returnError && (
        <FocusOnMount className="mt-6">
          {/* 포커스로 읽히므로 live 영역을 겹치지 않는다 */}
          <Notice variant="error" live={false} title={t(`returnErrors.${returnError}`)} />
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
      ) : !sellable ? (
        <Notice variant="info" live={false} className="mt-6" title={t("inactiveTitle")}>
          <p>
            <Link href="/pricing" className="font-semibold text-[var(--color-seal)] underline underline-offset-2">
              {t("pricingLink")}
            </Link>
          </p>
        </Notice>
      ) : mor ? (
        <>
          <section aria-labelledby="checkout-summary" className="doc-card mt-6 p-6">
            <h2 id="checkout-summary" className="font-display text-xl font-bold">
              {t("summaryTitle")}
            </h2>
            <dl className="mt-4 divide-y divide-[var(--color-line)] text-sm">
              <div className={ROW}>
                <dt className="font-semibold">{t("plan")}</dt>
                <dd>{planNameFor(terms.planCode)}</dd>
              </div>
              <div className={ROW}>
                <dt className="font-semibold">{t("amount")}</dt>
                <dd>{t("mor.amountValue", { amount: money })}</dd>
              </div>
              <div className={ROW}>
                <dt className="font-semibold">{t("cycle")}</dt>
                <dd>{t(`cycleValue.${terms.interval}`)}</dd>
              </div>
              <div className={ROW}>
                <dt className="font-semibold">{t("firstCharge")}</dt>
                <dd>{t("mor.firstChargeValue")}</dd>
              </div>
            </dl>
            <ul className="mt-5 list-disc space-y-2 pl-5 text-sm leading-relaxed">
              <li>{t(`mor.renewal.${terms.interval}`)}</li>
              <li>{t("mor.renewalDate")}</li>
              <li>{t("mor.taxNote")}</li>
              <li>{t("mor.cancelHow")}</li>
            </ul>
            <p className="mt-4 text-sm font-semibold leading-relaxed">{t("mor.seller")}</p>
          </section>
          <MorCheckoutForm priceId={price.id} />
        </>
      ) : (
        <>
          <section aria-labelledby="checkout-summary" className="doc-card mt-6 p-6">
            <h2 id="checkout-summary" className="font-display text-xl font-bold">
              {t("summaryTitle")}
            </h2>
            <dl className="mt-4 divide-y divide-[var(--color-line)] text-sm">
              <div className={ROW}>
                <dt className="font-semibold">{t("plan")}</dt>
                <dd>{planNameFor(terms.planCode)}</dd>
              </div>
              <div className={ROW}>
                <dt className="font-semibold">{t("amount")}</dt>
                <dd>{t("amountValue", { amount: money })}</dd>
              </div>
              <div className={ROW}>
                <dt className="font-semibold">{t("cycle")}</dt>
                <dd>{t(`cycleValue.${terms.interval}`)}</dd>
              </div>
              <div className={ROW}>
                <dt className="font-semibold">{t("firstCharge")}</dt>
                <dd>{t("firstChargeValue", { date: day(terms.firstChargeAt), amount: money })}</dd>
              </div>
              <div className={ROW}>
                <dt className="font-semibold">{t("period")}</dt>
                <dd>{t("periodValue", { start: day(terms.firstChargeAt), end: day(terms.periodEnd) })}</dd>
              </div>
              <div className={ROW}>
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
