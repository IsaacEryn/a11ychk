"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { submitReferralAppeal } from "@/lib/actions";
import type { SaveState } from "@/lib/actions";
import { useCopyToClipboard } from "@/lib/useCopyToClipboard";

export interface ReferralRow {
  id: string;
  status: "pending" | "valid" | "suspect" | "rejected";
  suspectReason: string | null;
  appealNote: string | null;
  createdAt: string;
}

/**
 * 마이페이지 초대 카드 — 내 초대 링크·진행 현황·초대 건 상태 목록.
 * suspect 건은 소명(appeal)을 제출해 관리자 심사를 요청할 수 있다.
 */
export function ReferralCard({
  link,
  validCount,
  goal,
  cap,
  rows,
  earned,
  invitedBonus,
}: {
  link: string | null;
  validCount: number;
  goal: number;
  cap: number;
  rows: ReferralRow[];
  earned: "plus1" | "plus2" | null;
  invitedBonus: boolean;
}) {
  const t = useTranslations("mypage.referral");
  const { status: copyStatus, copy } = useCopyToClipboard();
  const copied = copyStatus === "copied";

  return (
    <section aria-labelledby="referral-heading" className="doc-card mt-6 p-6">
      <h2 id="referral-heading" className="font-display text-xl font-bold">
        {t("title")}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">{t("intro", { goal })}</p>

      {/* 현재 달성 등급·피초대 보너스 안내 */}
      <p className="mt-2 text-sm">
        <span className="font-semibold">{t("earnedLabel")}: </span>
        <span className={earned ? "font-bold text-[var(--color-seal)]" : "text-[var(--color-ink-faint)]"}>
          {earned ? t(`earned.${earned}`) : t("earned.none")}
        </span>
        {invitedBonus && <span className="ml-2 text-xs text-[var(--color-seal)]">{t("invitedBonus")}</span>}
      </p>
      <p className="mt-1 text-xs text-[var(--color-ink-faint)]">{t("plus2Hint")}</p>

      {link ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)] px-3 py-2 text-sm">
            {link}
          </code>
          <button
            type="button"
            onClick={() => copy(link)}
            className="rounded border-[1.5px] border-[var(--color-seal)] px-3 py-2 text-sm font-bold text-[var(--color-seal)] hover:bg-[var(--color-seal-tint)]"
          >
            {copied ? t("copied") : t("copy")}
          </button>
          <span role="status" className="sr-only">
            {copied ? t("copied") : ""}
          </span>
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--color-ink-faint)]">{t("linkUnavailable")}</p>
      )}

      <p className="mt-4 text-sm font-semibold" aria-live="polite">
        {t("progress", { count: validCount, goal })}
      </p>
      <div className="mt-1 h-2 overflow-hidden rounded bg-[var(--color-line)]" aria-hidden="true">
        <div
          className="h-full rounded bg-[var(--color-seal)] transition-[width]"
          style={{ width: `${Math.min(100, Math.round((validCount / goal) * 100))}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-[var(--color-ink-faint)]">{t("capNote", { cap })}</p>

      {rows.length > 0 && (
        <ul className="mt-4 space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded border-[1.5px] border-[var(--color-line)] p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    r.status === "valid"
                      ? "bg-[var(--color-seal-tint)] text-[var(--color-seal)]"
                      : r.status === "suspect"
                        ? "bg-[var(--color-warn-tint)] text-[var(--color-ink)]"
                        : r.status === "rejected"
                          ? "bg-[var(--color-crit-tint)] text-[var(--color-crit)]"
                          : "bg-[var(--color-paper-warm)] text-[var(--color-ink-soft)]"
                  }`}
                >
                  {t(`status.${r.status}`)}
                </span>
                <span className="text-xs text-[var(--color-ink-faint)]">
                  {new Date(r.createdAt).toLocaleDateString()}
                </span>
                {r.status === "suspect" && r.suspectReason && (
                  <span className="text-xs text-[var(--color-ink-soft)]">
                    {t(`suspectReason.${r.suspectReason === "same_ip" ? "same_ip" : "cap"}`)}
                  </span>
                )}
              </div>
              {r.status === "suspect" &&
                (r.appealNote ? (
                  <p className="mt-2 text-xs text-[var(--color-ink-soft)]">{t("appeal.submitted")}</p>
                ) : (
                  <AppealForm referralId={r.id} />
                ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** suspect 건 소명 폼 — 제출하면 관리자 심사 대기 */
function AppealForm({ referralId }: { referralId: string }) {
  const t = useTranslations("mypage.referral");
  const [state, formAction, pending] = useActionState<SaveState, FormData>(submitReferralAppeal, {});
  const inputId = `appeal-${referralId}`;

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={referralId} />
      <label htmlFor={inputId} className="sr-only">
        {t("appeal.label")}
      </label>
      <input
        id={inputId}
        name="note"
        maxLength={500}
        required
        placeholder={t("appeal.placeholder")}
        className="min-w-0 flex-1 rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-2 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded border-[1.5px] border-[var(--color-seal)] px-3 py-1.5 text-sm font-semibold text-[var(--color-seal)] hover:bg-[var(--color-seal-tint)] disabled:opacity-60"
      >
        {t("appeal.submit")}
      </button>
      <span role="status" className="text-xs text-[var(--color-ink-faint)]">
        {state.ok ? t("appeal.saved") : state.error ? t("appeal.error") : ""}
      </span>
    </form>
  );
}
