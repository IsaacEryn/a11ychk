import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { FocusOnMount } from "@/components/FocusOnMount";
import { Notice } from "@/components/Notice";
import { manageReturnOf, returnErrorOf } from "@/lib/billing/checkout";
import { billingMode, entitlementLivemodes, rowLivemode } from "@/lib/billing/config";
import { planNameFor } from "@/lib/billing/flows/subscribe";
import { httpUrl } from "@/lib/billing/httpUrl";
import {
  hasBillingRecord,
  loadCardSummaries,
  loadLiveSubscriptions,
  loadPaymentHistory,
  type ManagedSubscription,
} from "@/lib/billing/manageData";
import { graceUntil, upcomingChargeAt } from "@/lib/billing/period";
import type { CardSummary } from "@/lib/billing/toss";
import { loadEntitlement } from "@/lib/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CancelSection, type CancelTarget } from "./CancelSection";
import { CardChangeButton } from "./CardChangeButton";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "billing.manage" });
  // 로그인 사용자 개인 화면 — 색인하지 않는다(robots.txt도 /mypage를 막는다)
  return { title: t("title"), robots: { index: false } };
}

/** 토스가 주는 카드 종류(한국어 값) → 표시 문구 키 */
const CARD_TYPES: Record<string, "credit" | "check" | "gift"> = { 신용: "credit", 체크: "check", 기프트: "gift" };

/** 사용자가 결제 관리에서 다루는 토스 정기결제 행 */
const isTossSubscription = (s: ManagedSubscription) => s.provider === "toss" && s.interval !== "contract";
/** 기관 계약의 시작일이 지났는지 — 이 화면은 요청마다 렌더된다(로그인 쿠키) */
const hasStarted = (s: ManagedSubscription) => Date.now() >= Date.parse(s.current_period_start);
/** 보여 줄 다음 결제일 — 가장 이른 청구 시각이 지났으면(마지막 날) 오늘 */
const nextChargeShown = (s: ManagedSubscription) => upcomingChargeAt(s.current_period_end, Date.now());

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
 * 결제 내역. 토스 결제창에서 돌아온 결과(?result=)·오류(?error=)는 맨 위에 보인다(목록 밖의 값은 무시).
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
  const shortDay = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const money = (amount: number, currency: string) => format.number(amount, { style: "currency", currency });
  const cardText = (card: CardSummary | undefined) => {
    if (!card?.number) return null;
    const typeKey = card.cardType ? CARD_TYPES[card.cardType] : undefined;
    const type = typeKey ? t(`cardType.${typeKey}`) : card.cardType;
    return [type, card.number].filter(Boolean).join(" ");
  };
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
          nextCharge: day(nextChargeShown(actionable)),
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

      {/* 결제창에서 돌아온 결과 — 오류·재결제 실패는 화면에 들어오자마자 포커스를 옮겨 먼저 읽히게 한다 */}
      {/* 포커스로 읽히므로 live 영역을 겹치지 않는다(live={false}) */}
      {returnError && (
        <FocusOnMount className="mt-6">
          <Notice variant="error" live={false} title={t(`returnErrors.${returnError}`)} />
        </FocusOnMount>
      )}
      {returned?.kind === "cardChanged" && returned.retry === "failed" ? (
        <FocusOnMount className="mt-6">
          <Notice variant="warn" live={false} title={t("results.cardChanged.failed")} />
        </FocusOnMount>
      ) : returned ? (
        <Notice
          variant={returned.kind === "pending" || (returned.kind === "cardChanged" && returned.retry === "pending") ? "info" : "success"}
          className="mt-6"
          title={returned.kind === "cardChanged" ? t(`results.cardChanged.${returned.retry}`) : t(`results.${returned.kind}`)}
        />
      ) : null}

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

      {(actionLivemode !== null || tossRows.length > 0) && (
        <section aria-labelledby="billing-subscription-heading" className="doc-card mt-6 p-6">
          <h2 id="billing-subscription-heading" className="font-display text-xl font-bold">
            {t("subscription.title")}
          </h2>
          {tossRows.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
              {t("subscription.none")}{" "}
              <Link href="/pricing" className="font-semibold text-[var(--color-seal)] underline underline-offset-2">
                {t("subscription.pricingLink")}
              </Link>
            </p>
          ) : (
            tossRows.map((s) => {
              // 지금 모드가 만드는 행에만 버튼이 있다. 나머지(결제 꺼짐·test 모드의 실결제 행)는 크론도 이 서버에서
              // 결제하지 않으니 다음 결제일·카드 변경 같은 동작 안내 없이 사실만 보인다
              const canAct = s.id === actionable?.id;
              const pastDue = s.status === "past_due";
              const status = pastDue
                ? t("subscription.statusPastDue")
                : s.cancel_at_period_end
                  ? t("subscription.statusScheduled", { date: day(s.current_period_end) })
                  : canAct
                    ? t("subscription.statusActive", { date: day(nextChargeShown(s)) })
                    : t("subscription.statusActiveUntil", { date: day(s.current_period_end) });
              const card = cardText(cards.get(s.livemode));
              return (
                <div key={s.id} className="mt-4">
                  {pastDue && (
                    // 정적 안내 — 화면을 열 때마다 알림으로 읽히지 않게 live 영역이 아닌 강조 상자로 둔다
                    <Notice variant="warn" live={false} title={t("subscription.pastDueTitle")}>
                      {canAct && <p>{t("subscription.pastDueBody", { date: day(s.grace_until ?? graceUntil(s.current_period_end)) })}</p>}
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
                    <CardChangeButton subscriptionId={s.id} emphasize={pastDue} />
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
                  // 결제사가 준 주소 — http(s)만 링크로 싣는다(서버에서 열지 않는다)
                  const receipt = httpUrl(p.receipt_url);
                  return (
                    <tr key={p.id} className="border-b border-[var(--color-line)]">
                      <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums">{shortDay(p.approved_at ?? p.requested_at)}</td>
                      <td className="py-2.5 pr-3">
                        {t(`payments.kind.${p.kind}`)}
                        {isTestRow(p.livemode) && ` · ${t("payments.testTag")}`}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums">{money(p.amount, p.currency)}</td>
                      <td className="py-2.5 pr-3">{t(`payments.status.${p.status}`)}</td>
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
