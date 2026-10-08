"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createPrice, type SaveState } from "@/lib/actions";
import { PRICE_AMOUNT_MAX, PRICE_AMOUNT_MIN, PRICE_INTERVALS, SELF_SERVE_PLAN_IDS } from "@/lib/billing/price";
import { FormFeedback } from "@/components/FormFeedback";
import { useAdminAction } from "../../useAdminAction";
import { BTN_PRIMARY, FIELD, HINT, LABEL, useManualSubmit } from "../contractForm";

/** createPrice가 돌려주는 오류 코드 전부 */
const ERROR_CODES = ["invalid", "activeExists", "migrationMissing", "failed"] as const;

type Values = { planCode: string; interval: string; amount: string; livemode: string; active: boolean };

const INITIAL: Values = { planCode: SELF_SERVE_PLAN_IDS[0], interval: "month", amount: "", livemode: "test", active: true };

/**
 * 가격 추가 폼 — 금액은 저장소에 두지 않고 이 화면에서만 넣는다.
 * 입력은 제어 컴포넌트이고 제출은 수동(useManualSubmit)이다: React 19의 <form action> 자동 reset은 select를
 * 첫 옵션으로 되돌리고 포커스된 number 입력을 비우므로, 오류(activeExists 등)가 나도 입력이 남도록 피하고
 * 추가에 성공했을 때만 처음 값으로 되돌린다.
 */
export function PriceCreateForm() {
  const t = useTranslations("admin.billing.prices");
  const plans = useTranslations("admin.users.plans");
  const [state, formAction, pending] = useAdminAction<SaveState, FormData>(createPrice, {});
  const onSubmit = useManualSubmit(formAction);
  const errors = Object.fromEntries(ERROR_CODES.map((c) => [c, t(`errors.${c}`)])) as Record<string, string>;

  const [values, setValues] = useState<Values>(INITIAL);
  const set = (key: "planCode" | "interval" | "amount" | "livemode") => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  // 제출 결과가 새로 오면(useActionState는 제출마다 새 객체를 준다) 성공한 경우에만 입력을 비운다
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) setValues(INITIAL);
  }

  return (
    <form method="post" onSubmit={onSubmit} className="mt-3 grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor="price-plan" className={LABEL}>
          {t("plan")}
        </label>
        <select id="price-plan" name="planCode" value={values.planCode} onChange={set("planCode")} className={FIELD}>
          {SELF_SERVE_PLAN_IDS.map((p) => (
            <option key={p} value={p}>
              {plans(p)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="price-interval" className={LABEL}>
          {t("interval")}
        </label>
        <select id="price-interval" name="interval" value={values.interval} onChange={set("interval")} className={FIELD}>
          {PRICE_INTERVALS.map((i) => (
            <option key={i} value={i}>
              {t(`intervals.${i}`)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="price-amount" className={LABEL}>
          {t("amount")}
        </label>
        <input
          id="price-amount"
          name="amount"
          type="number"
          required
          min={PRICE_AMOUNT_MIN}
          max={PRICE_AMOUNT_MAX}
          step={1}
          inputMode="numeric"
          value={values.amount}
          onChange={set("amount")}
          aria-describedby="price-amount-hint"
          className={FIELD}
        />
        <p id="price-amount-hint" className={HINT}>
          {t("amountHint", { min: PRICE_AMOUNT_MIN, max: PRICE_AMOUNT_MAX })}
        </p>
      </div>
      <div>
        <label htmlFor="price-livemode" className={LABEL}>
          {t("mode")}
        </label>
        <select
          id="price-livemode"
          name="livemode"
          value={values.livemode}
          onChange={set("livemode")}
          aria-describedby="price-mode-hint"
          className={FIELD}
        >
          <option value="test">{t("modes.test")}</option>
          <option value="live">{t("modes.live")}</option>
        </select>
        <p id="price-mode-hint" className={HINT}>
          {t("modeHint")}
        </p>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="price-active" className="flex items-start gap-2 text-sm font-semibold">
          <input
            id="price-active"
            name="active"
            type="checkbox"
            checked={values.active}
            onChange={(e) => setValues((v) => ({ ...v, active: e.target.checked }))}
            aria-describedby="price-active-hint"
            className="mt-1 size-4 shrink-0 accent-[var(--color-seal)]"
          />
          <span>{t("activeLabel")}</span>
        </label>
        <p id="price-active-hint" className={`${HINT} ml-6`}>
          {t("activeHint")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button type="submit" disabled={pending} className={BTN_PRIMARY}>
          {pending ? t("creating") : t("create")}
        </button>
        <FormFeedback state={state} okLabel={t("created")} errors={errors} fallback={errors.failed} />
      </div>
    </form>
  );
}
