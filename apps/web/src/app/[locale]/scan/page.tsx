import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkQuota, getResets, getSampleSize, resolveLimits } from "@/lib/quota";
import { getPlansActive } from "@/lib/appSettings";
import { ScanForm } from "./ScanForm";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "scanPage" });
  return { title: t("title") };
}

export default async function ScanRunPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("scanPage");
  const tDash = await getTranslations("dashboard");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  const [{ data: profile }, { data: verifiedDomains }] = await Promise.all([
    supabase.from("profiles").select("scan_limit_override").eq("id", user.id).single(),
    supabase.from("domains").select("hostname").eq("user_id", user.id).eq("verified", true),
  ]);

  const admin = createAdminClient();
  const plansActive = await getPlansActive(admin);
  const quota = await checkQuota(
    admin,
    user.id,
    resolveLimits(profile?.scan_limit_override, plansActive),
    getResets(profile?.scan_limit_override),
  );
  // 직접 입력 상한 — 소유 확인 여부에 따라 다르므로 두 값을 모두 넘겨 폼이 도메인별로 판단
  const verifiedSize = getSampleSize({ override: profile?.scan_limit_override, verified: true, plansActive });
  const unverifiedSize = getSampleSize({ override: profile?.scan_limit_override, verified: false, plansActive });
  const verifiedHostnames = (verifiedDomains ?? []).map((d) => d.hostname);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-[var(--color-ink-soft)]">{t("desc")}</p>

      <section aria-labelledby="scan-form-heading" className="doc-card mt-8 p-6">
        <h2 id="scan-form-heading" className="font-display text-xl font-bold">
          {tDash("scanForm.legend")}
        </h2>
        <ScanForm
          verifiedSize={verifiedSize}
          unverifiedSize={unverifiedSize}
          verifiedHostnames={verifiedHostnames}
          labels={{
            label: tDash("scanForm.label"),
            placeholder: tDash("scanForm.placeholder"),
            submit: tDash("scanForm.submit"),
            submitting: tDash("scanForm.submitting"),
            advanced: tDash("scanForm.advanced"),
            target: tDash("scanForm.target"),
            targetHint: tDash("scanForm.targetHint"),
            notes: tDash("scanForm.notes"),
            notesPlaceholder: tDash("scanForm.notesPlaceholder"),
            modeLegend: t("modeLegend"),
            modeAuto: t("modeAuto"),
            modeAutoDesc: t("modeAutoDesc"),
            modeManual: t("modeManual"),
            modeManualDesc: t("modeManualDesc"),
            manualLabel: t("manualLabel"),
            manualPlaceholder: t("manualPlaceholder"),
            manualCount: t("manualCount"),
            manualOriginHint: t("manualOriginHint"),
            manualOverLimit: t("manualOverLimit"),
            manualVerifyHint: t("manualVerifyHint"),
          }}
        />
        <p className="mt-3 text-sm text-[var(--color-ink-faint)]">{tDash("scanForm.hint")}</p>
        <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <Link href="/access-check" className="font-semibold text-[var(--color-seal)] underline underline-offset-4">
            {t("accessCheckLink")}
          </Link>
          <Link href="/extension/connect" className="font-semibold text-[var(--color-seal)] underline underline-offset-4">
            {tDash("scanForm.extensionLink")}
          </Link>
        </p>
      </section>

      {/* 남은 횟수 요약 */}
      <section aria-labelledby="scan-quota-heading" className="doc-card mt-6 p-6">
        <h2 id="scan-quota-heading" className="font-display text-xl font-bold">
          {tDash("quota.title")}
        </h2>
        <dl className="mt-4 grid grid-cols-3 gap-3">
          {(["daily", "weekly", "monthly"] as const).map((key) => (
            <div key={key} className="border-l-[3px] border-[var(--color-seal)] pl-3">
              <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{tDash(`quota.${key}`)}</dt>
              <dd className="font-bold tabular-nums">
                {tDash("quota.unit", { used: quota.used[key], limit: quota.limits[key] })}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
