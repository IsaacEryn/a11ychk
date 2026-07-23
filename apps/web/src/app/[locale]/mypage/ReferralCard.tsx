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
 * 등급 올리기(미션) 카드 — 프로 등급 미만 사용자에게 플러스1·플러스2 상향 경로를
 * 미션 형태로 안내한다. 미션1(친구 초대)·미션2(소유확인+보고서 공개, 플러스1 선행)의
 * 진행 단계와 내 초대 링크·성립 현황·소명을 함께 보여준다.
 */
export function MissionCard({
  link,
  validCount,
  goal,
  cap,
  mission1Done,
  domainVerified,
  reportPublished,
  mission2Done,
  rows,
}: {
  link: string | null;
  validCount: number;
  goal: number;
  cap: number;
  mission1Done: boolean;
  domainVerified: boolean;
  reportPublished: boolean;
  mission2Done: boolean;
  rows: ReferralRow[];
}) {
  const t = useTranslations("mypage.referral");
  const { status: copyStatus, copy } = useCopyToClipboard();
  const copied = copyStatus === "copied";

  const badge = (done: boolean) => (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
        done ? "bg-[var(--color-seal-tint)] text-[var(--color-seal)]" : "bg-[var(--color-paper-warm)] text-[var(--color-ink-soft)]"
      }`}
    >
      {done ? t("badgeDone") : t("badgeInProgress")}
    </span>
  );

  return (
    <section aria-labelledby="mission-heading" className="doc-card mt-6 p-6">
      <h2 id="mission-heading" className="font-display text-xl font-bold">
        {t("title")}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">{t("intro")}</p>

      {/* ── 미션 1: 플러스1 (친구 초대) ── */}
      <div className="mt-5 rounded-lg border-[1.5px] border-[var(--color-line)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display font-bold">{t("m1Title")}</span>
          {badge(mission1Done)}
        </div>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{t("m1Desc", { goal })}</p>

        <p className="mt-3 text-sm font-semibold" aria-live="polite">
          {t("progress", { count: validCount, goal })}
        </p>
        <div className="mt-1 h-2 overflow-hidden rounded bg-[var(--color-line)]" aria-hidden="true">
          <div
            className="h-full rounded bg-[var(--color-seal)] transition-[width]"
            style={{ width: `${Math.min(100, Math.round((validCount / goal) * 100))}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-[var(--color-ink-faint)]">{t("capNote", { cap })}</p>

        {link ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
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
          <p className="mt-3 text-sm text-[var(--color-ink-faint)]">{t("linkUnavailable")}</p>
        )}
      </div>

      {/* ── 미션 2: 플러스2 (플러스1 + 소유확인 + 보고서 공개) ── */}
      <div className="mt-4 rounded-lg border-[1.5px] border-[var(--color-line)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display font-bold">{t("m2Title")}</span>
          {badge(mission2Done)}
        </div>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{t("m2Desc")}</p>
        <ul className="mt-3 space-y-1.5 text-sm">
          <MissionStep done={mission1Done} label={t("step.plus1", { goal })} />
          <MissionStep done={domainVerified} label={t("step.domain")} />
          <MissionStep done={reportPublished} label={t("step.report")} />
        </ul>
      </div>

      {/* ── 초대 성립 현황 + 소명 ── */}
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

/** 미션 하위 단계 — 체크 상태를 기호+텍스트로 전달(색 단독 의존 회피) */
function MissionStep({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs font-bold ${
          done ? "bg-[var(--color-seal)] text-white" : "border-[1.5px] border-[var(--color-line)] text-[var(--color-ink-faint)]"
        }`}
      >
        {done ? "✓" : "○"}
      </span>
      <span className={done ? "text-[var(--color-ink)]" : "text-[var(--color-ink-soft)]"}>{label}</span>
    </li>
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
