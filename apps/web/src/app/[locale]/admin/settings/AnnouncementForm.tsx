"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { publishAnnouncement, clearAnnouncementBanner, type SaveState } from "@/lib/actions";
import { FormFeedback } from "@/components/FormFeedback";

const inputCls =
  "w-full rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1.5 text-sm";

/** 서비스 공지 발행 폼 — 발행 시 배너 노출(기존 공지는 배너에서 내려가고 /notices 이력 유지) */
export function AnnouncementForm({ activeTitle }: { activeTitle: string | null }) {
  const t = useTranslations("admin.announcement");
  const [state, formAction, pending] = useActionState<SaveState, FormData>(publishAnnouncement, {});
  const [clearState, clearAction, clearPending] = useActionState<SaveState, FormData>(clearAnnouncementBanner, {});

  return (
    <section className="mt-4 border-[1.5px] border-dashed border-[var(--color-line)] p-4">
      <h3 className="font-display text-lg font-bold">{t("title")}</h3>
      <p className="mt-1 text-xs text-[var(--color-ink-faint)]">{t("hint")}</p>

      {activeTitle && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{t("current")}:</span>
          <span className="text-[var(--color-ink-soft)]">{activeTitle}</span>
          <form action={clearAction} className="flex items-center gap-2">
            <button
              type="submit"
              disabled={clearPending}
              className="rounded border-[1.5px] border-[var(--color-crit)] px-2.5 py-1 text-xs font-bold text-[var(--color-crit)] hover:bg-[var(--color-crit-tint)] disabled:opacity-60"
            >
              {t("clear")}
            </button>
            <FormFeedback state={clearState} okLabel={t("cleared")} fallback={t("failed")} />
          </form>
        </div>
      )}

      <form action={formAction} className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ann-title-ko" className="mb-1 block text-xs font-semibold">
            {t("titleKo")}
          </label>
          <input id="ann-title-ko" name="titleKo" type="text" required maxLength={120} className={inputCls} />
        </div>
        <div>
          <label htmlFor="ann-title-en" className="mb-1 block text-xs font-semibold">
            {t("titleEn")}
          </label>
          <input id="ann-title-en" name="titleEn" type="text" required maxLength={120} className={inputCls} />
        </div>
        <div>
          <label htmlFor="ann-body-ko" className="mb-1 block text-xs font-semibold">
            {t("bodyKo")}
          </label>
          <textarea id="ann-body-ko" name="bodyKo" required maxLength={4000} rows={6} className={inputCls} />
        </div>
        <div>
          <label htmlFor="ann-body-en" className="mb-1 block text-xs font-semibold">
            {t("bodyEn")}
          </label>
          <textarea id="ann-body-en" name="bodyEn" required maxLength={4000} rows={6} className={inputCls} />
        </div>
        <div className="flex items-center gap-2 sm:col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2 text-sm font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
          >
            {pending ? t("publishing") : t("publish")}
          </button>
          <FormFeedback
            state={state}
            okLabel={t("published")}
            errors={{ invalid: t("invalid") }}
            fallback={t("failed")}
          />
        </div>
      </form>
    </section>
  );
}
