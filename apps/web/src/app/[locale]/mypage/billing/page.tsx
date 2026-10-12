import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { FocusOnMount } from "@/components/FocusOnMount";
import { Notice } from "@/components/Notice";
import { cardLabel } from "@/lib/billing/cardLabel";
import { manageReturnOf, returnErrorOf } from "@/lib/billing/checkout";
import { billingMode, entitlementLivemodes, rowLivemode } from "@/lib/billing/config";
import { planNameFor } from "@/lib/billing/flows/subscribe";
import { httpUrl } from "@/lib/billing/httpUrl";
import {
  hasBillingRecord,
  loadCardSummaries,
  loadLiveSubscriptions,
  loadPaymentHistory,
  nextChargeAt,
  paymentStatusKey,
  type ManagedSubscription,
} from "@/lib/billing/manageData";
import { graceOver, graceUntil, upcomingChargeAt } from "@/lib/billing/period";
import { amountInMajorUnits } from "@/lib/billing/price";
import { loadEntitlement } from "@/lib/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CancelSection, type CancelTarget } from "./CancelSection";
import { CardChangeButton } from "./CardChangeButton";
import { MorPortalButton } from "./MorPortalButton";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "billing.manage" });
  // 로그인 사용자 개인 화면 — 색인하지 않는다(robots.txt도 /mypage를 막는다)
  return { title: t("title"), robots: { index: false } };
}

/** 사용자가 결제 관리에서 다루는 토스 정기결제 행 */
const isTossSubscription = (s: ManagedSubscription) => s.provider === "toss" && s.interval !== "contract";
/** 해외 결제(판매 대행 Polar) 구독 행 — 해지·결제 수단은 Polar 고객 포털이 맡아 토스 버튼을 붙이지 않는다 */
const isMorSubscription = (s: ManagedSubscription) => s.provider === "mor";
/** 기관 계약의 시작일이 지났는지 — 이 화면은 요청마다 렌더된다(로그인 쿠키) */
const hasStarted = (s: ManagedSubscription) => Date.now() >= Date.parse(s.current_period_start);
/**
 * 유예가 끝난 미납 — 다음 크론이 끝낸다(크론의 미납 종료와 같은 기준). 카드 변경(재결제)은 막혀 있으니 버튼 대신 중립 안내를
 * 보이고, 지난 날짜(유예 기한)는 보이지 않는다
 */
const isEnding = (s: ManagedSubscription) => s.status === "past_due" && graceOver(s, Date.now());

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-2.5">
      <dt className="font-semibold">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * 결제 관리 — 현재 등급과 근거, 진행 중 구독(플랜·금액·상태·결제 카드)과 해지·해지 취소·카드 변경, 기관 계약(끝나는 날만),
 * 결제 내역. 토스·Polar 결제창에서 돌아온 결과(?result=)·오류(?error=)는 맨 위에 보인다(목록 밖의 값은 무시).
 * 해외 결제(Polar) 구독은 플랜·금액(USD, 세금 별도)·상태·다음 결제일(= 기간 끝)만 보이고, 해지·카드 변경 버튼 대신
 * "결제 관리(Polar)" 버튼으로 Polar 고객 포털을 연다(MorPortalButton). 금액은 행의 통화 단위(USD는 cent)를 바꿔 서식을 입힌다.
 *
 * 로그인 필수. 결제 모드가 꺼져 있으면 결제 행을 만들 수 없어 버튼은 없고, 구독·계약 행이 하나도 없으면 404다
 * (기관 계약 사용자는 꺼져 있어도 본다). 구독 행은 권한 계산과 같은 livemode 범위에서 읽고, 버튼은 지금 모드가 만드는
 * 행(rowLivemode)에만 붙인다. 기관 계약에는 버튼이 없다.
 * 구독·결제 내역은 사용자 세션으로(RLS — 자기 행), 카드 요약만 service role로 읽는다(마스킹 값만 화면에 넘긴다).
 */
export default async function BillingManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ result?: string | string[]; retry?: string | string[]; error?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/mypage/billing`)}`);

  const mode = billingMode();
  const actionLivemode = rowLivemode(mode);
  const livemodes = entitlementLivemodes(mode);

  const live = await loadLiveSubscriptions(supabase, user.id, livemodes);
  if (actionLivemode === null && live.length === 0 && !(await hasBillingRecord(supabase, user.id, livemodes))) notFound();

  const tossRows = live.filter(isTossSubscription);
  // 구독 칸에 보이는 행 — 토스와 해외 결제를 기간 끝 순서 그대로
  const subscriptionRows = live.filter((s) => isTossSubscription(s) || isMorSubscription(s));
  const contracts = live.filter((s) => s.provider === "manual");
  const actionable = actionLivemode === null ? null : (tossRows.find((s) => s.livemode === actionLivemode) ?? null);

  // 권한·카드 요약은 service role — 위에서 로그인 사용자를 확인했고, 그 사용자의 id로만 읽는다
  const admin = createAdminClient();
  const [ent, payments, cards] = await Promise.all([
    loadEntitlement(admin, user.id),
    loadPaymentHistory(supabase, user.id, livemodes),
    loadCardSummaries(admin, user.id, [...new Set(tossRows.map((s) => s.livemode))]),
  ]);

  const t = await getTranslations("billing.manage");
  const tTier = await getTranslations("mypage.tier");
  const tCheckout = await getTranslations("billing.checkout");
  const format = await getFormatter();
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "long" });
  // 해외 결제(Polar)의 기간은 UTC로 정해진다 — KST로 적으면 하루 어긋날 수 있어 UTC 날짜에 (UTC)를 붙인다(결제 확인 화면은 날짜를 적지 않는다)
  const utcDay = (iso: string) => t("subscription.utcDate", { date: format.dateTime(new Date(iso), { dateStyle: "long", timeZone: "UTC" }) });
  const shortDay = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  // 행의 통화 단위(KRW는 원, USD는 cent)를 화면 단위로 바꿔 서식을 입힌다
  const money = (amount: number, currency: "KRW" | "USD") => format.number(amountInMajorUnits(amount, currency), { style: "currency", currency });
  // 카드 표기는 결제 메일과 같은 함수(cardLabel)로 — 영문 화면에 한국어 카드 종류가 섞이지 않는다
  const cardLocale = locale === "en" ? "en" : "ko";
  // test 모드에서는 실결제 행과 테스트 행이 함께 보인다 — 테스트 행에 표시를 붙인다
  const isTestRow = (livemode: boolean) => mode === "test" && !livemode;

  const returnError = returnErrorOf(sp.error);
  const returned = returnError ? null : manageReturnOf(sp.result, sp.retry);

  const sourceText = (() => {
    switch (ent.source) {
      case "contract":
        return ent.until ? t("tier.source.contractUntil", { date: day(ent.until) }) : t("tier.source.contract");
      default:
        return t(`tier.source.${ent.source}`);
    }
  })();

  const cancelTarget: CancelTarget | null =
    actionable && (actionable.status === "active" || actionable.status === "past_due")
      ? {
          status: actionable.status,
          scheduled: actionable.status === "active" && actionable.cancel_at_period_end,
          endsAt: day(actionable.current_period_end),
          // 보여 줄 다음 결제일 — 가장 이른 청구 시각이 지났으면(마지막 날) 오늘
          nextCharge: day(upcomingChargeAt(actionable.current_period_end)),
        }
      : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p>
        <Link href="/mypage" className="text-sm font-bold text-[var(--color-seal)] underline underline-offset-4">
          {t("eyebrow")}
        </Link>
      </p>
      <h1 className="font-display mt-1 text-3xl font-bold">{t("title")}</h1>
      <p className="mt-2 leading-relaxed text-[var(--color-ink-soft)]">{t("desc")}</p>

      {mode === "test" && <Notice variant="warn" live={false} className="mt-6" title={tCheckout("testMode")} />}

      {/* 결제창에서 돌아온 결과(오류·성공·확인 중 모두) — 303으로 페이지를 새로 불러온 직후라 첫 렌더의 live 영역은 낭독되지 않는
          경우가 많다. 화면에 들어오자마자 포커스를 옮겨 먼저 읽히게 하고, 포커스로 읽히므로 live 영역을 겹치지 않는다(live={false}) */}
      {returnError && (
        <FocusOnMount className="mt-6">
          <Notice variant="error" live={false} title={t(`returnErrors.${returnError}`)} />
        </FocusOnMount>
      )}
      {returned && (
        <FocusOnMount className="mt-6">
          <Notice
            variant={
              returned.kind === "cardChanged" && (returned.retry === "failed" || returned.retry === "refunded")
                ? "warn"
                : returned.kind === "pending" || (returned.kind === "cardChanged" && returned.retry === "pending")
                  ? "info"
                  : "success"
            }
            live={false}
            title={returned.kind === "cardChanged" ? t(`results.cardChanged.${returned.retry}`) : t(`results.${returned.kind}`)}
          />
        </FocusOnMount>
      )}

      <section aria-labelledby="billing-tier-heading" className="doc-card mt-6 p-6">
        <h2 id="billing-tier-heading" className="font-display text-xl font-bold">
          {t("tier.title")}
        </h2>
        <p className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[var(--color-seal-tint)] px-3 py-1 text-sm font-bold text-[var(--color-seal)]">
            {tTier(ent.tier)}
          </span>
          <span className="text-sm text-[var(--color-ink-soft)]">{sourceText}</span>
        </p>
      </section>

      {contracts.map((c) => {
        const headingId = `billing-contract-${c.id}`;
        // 시작일이 아직 오지 않은 계약은 권한을 주지 않는다 — 끝나는 날 대신 시작일을 보인다
        const started = hasStarted(c);
        return (
          <section key={c.id} aria-labelledby={headingId} className="doc-card mt-6 p-6">
            <h2 id={headingId} className="font-display text-xl font-bold">
              {t("contract.title")}
            </h2>
            <dl className="mt-4 divide-y divide-[var(--color-line)] text-sm">
              <DetailRow label={t("contract.plan")}>{planNameFor(c.plan_code)}</DetailRow>
              <DetailRow label={t("contract.period")}>
                {started ? t("contract.until", { date: day(c.current_period_end) }) : t("contract.starts", { date: day(c.current_period_start) })}
              </DetailRow>
            </dl>
          </section>
        );
      })}

      {(actionLivemode !== null || subscriptionRows.length > 0) && (
        <section aria-labelledby="billing-subscription-heading" className="doc-card mt-6 p-6">
          <h2 id="billing-subscription-heading" className="font-display text-xl font-bold">
            {t("subscription.title")}
          </h2>
          {subscriptionRows.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
              {t("subscription.none")}{" "}
              <Link href="/pricing" className="font-semibold text-[var(--color-seal)] underline underline-offset-2">
                {t("subscription.pricingLink")}
              </Link>
            </p>
          ) : (
            subscriptionRows.map((s) => {
              if (isMorSubscription(s)) {
                // 지금 모드가 만드는 행에만 포털 버튼이 있다(이 배포의 Polar 토큰은 그 모드의 것뿐이다)
                const canOpen = actionLivemode !== null && s.livemode === actionLivemode;
                const pastDue = s.status === "past_due";
                const hintId = `billing-mor-hint-${s.id}`;
                const status = pastDue
                  ? t("subscription.statusPastDue")
                  : s.cancel_at_period_end
                    ? t("subscription.statusScheduled", { date: utcDay(s.current_period_end) })
                    : canOpen
                      ? t("subscription.statusActive", { date: utcDay(nextChargeAt(s)) })
                      : t("subscription.statusActiveUntil", { date: utcDay(s.current_period_end) });
                return (
                  <div key={s.id} className="mt-4">
                    {pastDue && (
                      // 정적 안내 — Polar가 결제를 다시 시도하고, 카드는 포털에서 바꾼다(live 영역 아님)
                      <Notice variant="warn" live={false} title={t("subscription.pastDueTitle")}>
                        {canOpen && <p>{t("subscription.pastDueBodyMor")}</p>}
                      </Notice>
                    )}
                    <dl className="mt-2 divide-y divide-[var(--color-line)] text-sm">
                      <DetailRow label={t("subscription.plan")}>
                        {planNameFor(s.plan_code)}
                        {isTestRow(s.livemode) && ` · ${t("subscription.testTag")}`}
                      </DetailRow>
                      <DetailRow label={t("subscription.amount")}>
                        {t("subscription.amountValueMor", {
                          amount: money(s.amount, s.currency),
                          cycle: tCheckout(`cycleValue.${s.interval === "year" ? "year" : "month"}`),
                        })}
                      </DetailRow>
                      <DetailRow label={t("subscription.status")}>{status}</DetailRow>
                      <DetailRow label={t("subscription.paymentMethod")}>{t("subscription.paymentMethodMor")}</DetailRow>
                    </dl>
                    {canOpen ? (
                      <>
                        <p id={hintId} className="mt-3 text-sm text-[var(--color-ink-soft)]">
                          {t("portal.hint")}
                        </p>
                        <MorPortalButton describedBy={hintId} emphasize={pastDue} />
                      </>
                    ) : (
                      <p className="mt-3 text-sm text-[var(--color-ink-soft)]">{t("subscription.readOnly")}</p>
                    )}
                  </div>
                );
              }
              // 지금 모드가 만드는 행에만 버튼이 있다. 나머지(결제 꺼짐·test 모드의 실결제 행)는 크론도 이 서버에서
              // 결제하지 않으니 다음 결제일·카드 변경 같은 동작 안내 없이 사실만 보인다
              const canAct = s.id === actionable?.id;
              const pastDue = s.status === "past_due";
              const ending = isEnding(s);
              const status = pastDue
                ? t("subscription.statusPastDue")
                : s.cancel_at_period_end
                  ? t("subscription.statusScheduled", { date: day(s.current_period_end) })
                  : canAct
                    ? t("subscription.statusActive", { date: day(upcomingChargeAt(s.current_period_end)) })
                    : t("subscription.statusActiveUntil", { date: day(s.current_period_end) });
              const card = cardLabel(cards.get(s.livemode), cardLocale);
              return (
                <div key={s.id} className="mt-4">
                  {pastDue && (
                    // 정적 안내 — 화면을 열 때마다 알림으로 읽히지 않게 live 영역이 아닌 강조 상자로 둔다
                    <Notice variant="warn" live={false} title={t("subscription.pastDueTitle")}>
                      {canAct &&
                        (ending ? (
                          <p>
                            {t("subscription.endingSoon")}{" "}
                            <Link href="/pricing" className="font-semibold text-[var(--color-seal)] underline underline-offset-2">
                              {t("subscription.pricingLink")}
                            </Link>
                          </p>
                        ) : (
                          <p>{t("subscription.pastDueBody", { date: day(s.grace_until ?? graceUntil(s.current_period_end)) })}</p>
                        ))}
                    </Notice>
                  )}
                  <dl className="mt-2 divide-y divide-[var(--color-line)] text-sm">
                    <DetailRow label={t("subscription.plan")}>
                      {planNameFor(s.plan_code)}
                      {isTestRow(s.livemode) && ` · ${t("subscription.testTag")}`}
                    </DetailRow>
                    <DetailRow label={t("subscription.amount")}>
                      {t("subscription.amountValue", {
                        amount: money(s.amount, s.currency),
                        cycle: tCheckout(`cycleValue.${s.interval === "year" ? "year" : "month"}`),
                      })}
                    </DetailRow>
                    <DetailRow label={t("subscription.status")}>{status}</DetailRow>
                    <DetailRow label={t("subscription.card")}>{card ?? t("subscription.cardNone")}</DetailRow>
                  </dl>
                  {canAct ? (
                    !ending && <CardChangeButton subscriptionId={s.id} emphasize={pastDue} />
                  ) : (
                    <p className="mt-3 text-sm text-[var(--color-ink-soft)]">{t("subscription.readOnly")}</p>
                  )}
                </div>
              );
            })
          )}
          {/* 결제 모드가 켜져 있으면 늘 같은 자리에 둔다 — 해지로 구독이 끝나 위 목록이 바뀌어도 결과 안내가 남는다 */}
          {actionLivemode !== null && <CancelSection sub={cancelTarget} />}
        </section>
      )}

      <section aria-labelledby="billing-payments-heading" className="mt-10">
        <h2 id="billing-payments-heading" className="font-display text-2xl font-bold">
          {t("payments.title")}
        </h2>
        {payments.length === 0 ? (
          <p className="mt-4 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-[var(--color-ink-faint)]">
            {t("payments.empty")}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
              <caption className="sr-only">{t("payments.caption")}</caption>
              <thead>
                <tr className="border-b-[1.5px] border-[var(--color-ink)] text-left">
                  <th scope="col" className="py-2 pr-3 font-bold">
                    {t("payments.colDate")}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-bold">
                    {t("payments.colKind")}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-bold">
                    {t("payments.colAmount")}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-bold">
                    {t("payments.colStatus")}
                  </th>
                  <th scope="col" className="py-2 font-bold">
                    {t("payments.colReceipt")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  // 결제사가 준 주소 — http(s)만 링크로 싣는다(서버에서 열지 않는다). 해외 결제(Polar) 영수증은 Polar가 메일·고객 포털로 준다
                  const receipt = httpUrl(p.receipt_url);
                  return (
                    <tr key={p.id} className="border-b border-[var(--color-line)]">
                      {/* 행 머리글 — "영수증 보기" 링크가 여러 개여도 어느 날짜의 결제인지 행 맥락으로 구분된다 */}
                      <th scope="row" className="whitespace-nowrap py-2.5 pr-3 text-left font-normal tabular-nums">
                        {shortDay(p.approved_at ?? p.requested_at)}
                      </th>
                      <td className="py-2.5 pr-3">
                        {t(`payments.kind.${p.kind}`)}
                        {isTestRow(p.livemode) && ` · ${t("payments.testTag")}`}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums">{money(p.amount, p.currency)}</td>
                      {/* 사용자 탓이 아닌 실패(설정 사고·대사로 확정)는 "실패" 대신 청구 없는 미처리로 */}
                      <td className="py-2.5 pr-3">{t(`payments.status.${paymentStatusKey(p)}`)}</td>
                      <td className="py-2.5">
                        {receipt ? (
                          <a
                            href={receipt}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-bold text-[var(--color-seal)] underline underline-offset-4"
                          >
                            {t("payments.receipt")}
                            <span className="sr-only"> {t("newWindow")}</span>
                          </a>
                        ) : p.provider === "mor" ? (
                          <span className="text-[var(--color-ink-soft)]">{t("payments.receiptPolar")}</span>
                        ) : (
                          <>
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">{t("payments.noReceipt")}</span>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
