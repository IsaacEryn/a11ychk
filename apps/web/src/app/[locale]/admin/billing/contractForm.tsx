"use client";

import { useTransition, type FormEvent } from "react";
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

/**
 * 폼 수동 제출 — `<form action>` 대신 onSubmit에서 FormData를 만들어 transition으로 액션을 부른다.
 * React 19는 `<form action>` 제출이 끝나면 폼을 자동으로 reset하는데, 제어 입력이어도 완전히 막지 못한다
 * (select는 defaultSelected를 동기화하지 않아 첫 옵션으로 되돌아가고, 포커스된 number 입력은 비워진다).
 * 오류 뒤에 관리자가 고른 값이 바뀌거나 사라지면 안 되므로 자동 reset 자체를 피한다.
 * 버튼의 pending 상태는 useAdminAction이 돌려주는 값을 그대로 쓴다(transition 안에서 불러도 정확하다).
 */
export function useManualSubmit(formAction: (formData: FormData) => void) {
  const [, startTransition] = useTransition();
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => formAction(formData));
  };
}

/** 선택 입력 레이블 뒤에 붙는 "(선택)" 표시 — 색에 기대지 않고 글자로 알린다 */
export function Optional() {
  const t = useTranslations("admin.billing.contract");
  return <span className="ml-1 font-normal text-[var(--color-ink-soft)]">{t("optional")}</span>;
}

/** 서버 액션(adminBilling)이 돌려주는 오류 코드 전부 */
const ERROR_CODES = [
  "invalid",
  "period",
  "hasActive",
  "notFound",
  "notManual",
  "ended",
  "migrationMissing",
  "userNotFound",
  "failed",
] as const;

/** FormFeedback에 넘길 오류 문구 맵과 fallback */
export function useContractErrors() {
  const t = useTranslations("admin.billing.contract.errors");
  return {
    errors: Object.fromEntries(ERROR_CODES.map((c) => [c, t(c)])) as Record<string, string>,
    fallback: t("failed"),
  };
}
