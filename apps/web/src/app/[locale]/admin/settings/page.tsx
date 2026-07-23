import { requireAdmin } from "@/lib/adminGuard";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bulkSetPages, bulkSetPlan, togglePlansActive } from "@/lib/actions";
import { ASSIGNABLE_PLAN_IDS, MAX_PAGES_PER_SCAN, PLANS } from "@/lib/quota";
import { getPlansActive } from "@/lib/appSettings";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.settings")} — ${t("title")}` };
}

/** 운영 설정 — 요금제 시행 토글 + 요금제/페이지 한도 일괄 적용 */
export default async function AdminSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드 (layout 가드만으로는 불충분)
  const t = await getTranslations("admin");

  const admin = createAdminClient();
  const plansActive = await getPlansActive(admin);

  return (
    <section aria-labelledby="admin-settings-heading" className="mt-8">
      <h2 id="admin-settings-heading" className="font-display text-2xl font-bold">
        {t("settings.title")}
      </h2>

      {/* 요금제 시행 상태 + 토글 */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper-warm)] p-4">
        <span
          className={`rounded-full px-3 py-1 text-sm font-bold ${
            plansActive
              ? "bg-[var(--color-seal-tint)] text-[var(--color-seal)]"
              : "bg-[var(--color-paper)] text-[var(--color-ink-faint)]"
          }`}
        >
          {plansActive ? t("plansControl.active") : t("plansControl.inactive")}
        </span>
        <p className="min-w-40 flex-1 text-sm text-[var(--color-ink-soft)]">{t("plansControl.hint")}</p>
        <form action={togglePlansActive}>
          <input type="hidden" name="active" value={String(plansActive)} />
          <button
            type="submit"
            className={`rounded border-[1.5px] px-4 py-2 text-sm font-bold ${
              plansActive
                ? "border-[var(--color-crit)] text-[var(--color-crit)] hover:bg-[var(--color-crit-tint)]"
                : "border-[var(--color-seal)] text-[var(--color-seal)] hover:bg-[var(--color-seal-tint)]"
            }`}
          >
            {plansActive ? t("plansControl.stop") : t("plansControl.start")}
          </button>
        </form>
      </div>

      {/* 요금제(그룹) 일괄 배정 */}
      <form
        action={bulkSetPlan}
        className="mt-4 flex flex-wrap items-end gap-2 border-[1.5px] border-dashed border-[var(--color-line)] p-4"
      >
        <div>
          <label htmlFor="bulk-plan" className="mb-1 block text-sm font-semibold">
            {t("users.bulkPlanLabel")}
          </label>
          <select
            id="bulk-plan"
            name="plan"
            defaultValue="free"
            className="rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2 text-sm"
          >
            {ASSIGNABLE_PLAN_IDS.map((p) => (
              <option key={p} value={p}>
                {t(`users.plans.${p}`)} (한도 {PLANS[p].daily}/{PLANS[p].weekly}/{PLANS[p].monthly} · 표본{" "}
                {Math.min(PLANS[p].sampleSize, MAX_PAGES_PER_SCAN)}p)
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2 text-sm font-bold hover:bg-[var(--color-paper-warm)]"
        >
          {t("users.bulkApply")}
        </button>
        <p className="w-full text-xs text-[var(--color-ink-faint)]">{t("users.bulkHint")}</p>
      </form>

      {/* 페이지 한도 일괄 설정 */}
      <form
        action={bulkSetPages}
        className="mt-4 flex flex-wrap items-end gap-2 border-[1.5px] border-dashed border-[var(--color-line)] p-4"
      >
        <div>
          <label htmlFor="bulk-pages" className="mb-1 block text-sm font-semibold">
            {t("settings.bulkPagesLabel")}
          </label>
          <input
            id="bulk-pages"
            name="pages"
            type="number"
            min={1}
            max={MAX_PAGES_PER_SCAN}
            inputMode="numeric"
            placeholder={String(PLANS.free.sampleSize)}
            aria-describedby="bulk-pages-hint"
            className="w-28 rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2 text-sm tabular-nums"
          />
        </div>
        <button
          type="submit"
          className="rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2 text-sm font-bold hover:bg-[var(--color-paper-warm)]"
        >
          {t("users.bulkApply")}
        </button>
        <p id="bulk-pages-hint" className="w-full text-xs text-[var(--color-ink-faint)]">
          {t("settings.bulkPagesHint", { max: MAX_PAGES_PER_SCAN })}
        </p>
      </form>
    </section>
  );
}
