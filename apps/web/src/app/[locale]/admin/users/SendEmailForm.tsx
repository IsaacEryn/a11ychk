"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { sendUserEmail, type SaveState } from "@/lib/actions";
import { FormFeedback } from "@/components/FormFeedback";

/** 샘플 양식 id — 본문은 i18n(admin.users.email.templates.*)에서 채운다 */
const TEMPLATE_IDS = ["welcome", "delay", "update", "feedback"] as const;

/** 관리자 → 사용자 메일 발송 폼 (접기형) — 샘플 양식 선택 시 제목·본문을 기본값으로 채운다 */
export function SendEmailForm({ userId }: { userId: string }) {
  const t = useTranslations("admin.users.email");
  const [state, formAction, pending] = useActionState<SaveState, FormData>(sendUserEmail, {});
  const [template, setTemplate] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  return (
    <details className="mt-2 border-[1.5px] border-dashed border-[var(--color-line)] p-3">
      <summary className="cursor-pointer text-xs font-bold text-[var(--color-ink-soft)]">
        {t("toggle")}
      </summary>
      <form action={formAction} className="mt-3 space-y-2">
        <input type="hidden" name="userId" value={userId} />
        <div>
          <label htmlFor={`email-template-${userId}`} className="mb-1 block text-xs font-semibold">
            {t("templates.label")}
          </label>
          <select
            id={`email-template-${userId}`}
            value={template}
            onChange={(e) => {
              const id = e.target.value;
              setTemplate(id);
              // 양식을 고르면 작성 중이던 내용을 기본 문안으로 교체한다 (직접 작성은 비움 유지)
              if (id) {
                setSubject(t(`templates.${id}.subject`));
                setBody(t(`templates.${id}.body`));
              }
            }}
            className="w-full rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1.5 text-xs"
          >
            <option value="">{t("templates.none")}</option>
            {TEMPLATE_IDS.map((id) => (
              <option key={id} value={id}>
                {t(`templates.${id}.name`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`email-subject-${userId}`} className="mb-1 block text-xs font-semibold">
            {t("subject")}
          </label>
          <input
            id={`email-subject-${userId}`}
            name="subject"
            type="text"
            required
            maxLength={200}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label htmlFor={`email-body-${userId}`} className="mb-1 block text-xs font-semibold">
            {t("body")}
          </label>
          <textarea
            id={`email-body-${userId}`}
            name="body"
            required
            maxLength={5000}
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1.5 text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-3 py-1.5 text-xs font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
          >
            {pending ? t("sending") : t("send")}
          </button>
          <FormFeedback
            state={state}
            okLabel={t("sent")}
            errors={Object.fromEntries(["invalid", "noEmail", "sendFailed"].map((c) => [c, t(`errors.${c}`)]))}
            fallback={t("errors.sendFailed")}
          />
        </div>
      </form>
    </details>
  );
}
