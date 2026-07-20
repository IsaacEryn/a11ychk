"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { createInquiry, type SaveState } from "@/lib/actions";
import { Notice } from "@/components/Notice";

type ErrorCode = "invalid" | "rateLimited" | "failed";

export function InquiryForm() {
  const t = useTranslations("inquiries.new");
  const [state, formAction, pending] = useActionState<SaveState, FormData>(createInquiry, {});
  const formRef = useRef<HTMLFormElement>(null);

  // 성공 시 입력 초기화. state는 제출마다 새 객체라 같은 성공이 반복돼도 매번 실행된다.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  const error = state.error as ErrorCode | undefined;
  // 결과 안내를 필드와 묶어 스크린리더가 오류 원인을 함께 읽도록 한다.
  const msgId = error || state.ok ? "inq-result" : undefined;

  return (
    <form ref={formRef} action={formAction} aria-busy={pending} className="doc-card mt-8 p-6">
      <fieldset>
        <legend className="font-display text-xl font-bold">{t("legend")}</legend>

        <div className="mt-4">
          <label htmlFor="inq-type" className="mb-1 block text-sm font-semibold">
            {t("type")}
          </label>
          <select
            id="inq-type"
            name="type"
            className="rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2"
          >
            <option value="feature">{t("typeFeature")}</option>
            <option value="bug">{t("typeBug")}</option>
            <option value="question">{t("typeQuestion")}</option>
          </select>
        </div>

        <div className="mt-4">
          <label htmlFor="inq-title" className="mb-1 block text-sm font-semibold">
            {t("subject")}
          </label>
          <input
            id="inq-title"
            name="title"
            type="text"
            required
            maxLength={200}
            aria-describedby={msgId}
            className="w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2"
          />
        </div>

        <div className="mt-4">
          <label htmlFor="inq-body" className="mb-1 block text-sm font-semibold">
            {t("body")}
          </label>
          <textarea
            id="inq-body"
            name="body"
            required
            rows={5}
            maxLength={5000}
            aria-describedby={msgId}
            className="w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="mt-4 rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
        >
          {pending ? t("submitting") : t("submit")}
        </button>
      </fieldset>

      {error && (
        <Notice variant="error" className="mt-4" title={t(`error.${error}`)}>
          <p id="inq-result">{t(`errorHint.${error}`)}</p>
        </Notice>
      )}
      {state.ok && (
        <Notice variant="success" className="mt-4" title={t("success")}>
          <p id="inq-result">{t("successHint")}</p>
        </Notice>
      )}
    </form>
  );
}
