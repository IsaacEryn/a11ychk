"use client";

import { useTranslations } from "next-intl";
import { INPUT } from "../tableStyles";

/**
 * 기관 계약 폼 4종이 같이 쓰는 클래스·오류 문구.
 * 입력창은 표 필터와 같은 INPUT(잉크색 테두리 — 입력 경계 3:1 대비)에 가로 폭만 채운다.
 */
export const FIELD = `${INPUT} w-full`;
export const LABEL = "mb-1 block text-xs font-semibold";
export const HINT = "mt-1 text-xs text-[var(--color-ink-faint)]";
export const BTN_PRIMARY =
  "rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-3 py-1.5 text-xs font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60";
export const BTN_DANGER =
  "rounded border-[1.5px] border-[var(--color-crit)] px-3 py-1.5 text-xs font-bold text-[var(--color-crit)] hover:bg-[var(--color-crit-tint)] disabled:opacity-60";

/** 선택 입력 레이블 뒤에 붙는 "(선택)" 표시 — 색에 기대지 않고 글자로 알린다 */
export function Optional() {
  const t = useTranslations("admin.billing.contract");
  return <span className="ml-1 font-normal text-[var(--color-ink-soft)]">{t("optional")}</span>;
}

/** 서버 액션(adminBilling)이 돌려주는 오류 코드 전부 */
const ERROR_CODES = ["invalid", "period", "hasActive", "notFound", "notManual", "ended", "failed"] as const;

/** FormFeedback에 넘길 오류 문구 맵과 fallback */
export function useContractErrors() {
  const t = useTranslations("admin.billing.contract.errors");
  return {
    errors: Object.fromEntries(ERROR_CODES.map((c) => [c, t(c)])) as Record<string, string>,
    fallback: t("failed"),
  };
}
