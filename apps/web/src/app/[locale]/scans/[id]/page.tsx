import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reclaimStaleScans } from "@/lib/scan/reclaimStale";
import { ScanProgress } from "./ScanProgress";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "scan" });
  return { title: t("title") };
}

export default async function ScanPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("scan");
  const tDash = await getTranslations("dashboard");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  // 좀비 검사 자가 치유 — 이 검사가 제한 시간을 넘겨 running/queued에 멈춰 있으면 failed로 정리
  await reclaimStaleScans(createAdminClient(), { scanId: id });

  const { data: scan } = await supabase.from("scans").select("id, root_url, status, error").eq("id", id).maybeSingle();
  if (!scan) notFound();
  if (scan.status === "done") redirect(`/${locale}/scans/${id}/report`);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <p className="mt-2 break-all text-[var(--color-ink-soft)]">
        <span className="font-semibold">{t("target")}:</span> {scan.root_url}
      </p>
      <ScanProgress
        scanId={scan.id}
        initialStatus={scan.status}
        initialError={scan.error}
        labels={{
          statusLive: t("statusLive"),
          pagesTitle: t("pagesTitle"),
          viewReport: t("viewReport"),
          failedTitle: t("failedTitle"),
          backToDashboard: t("backToDashboard"),
          runningDesc: t("runningDesc"),
          status: {
            queued: tDash("status.queued"),
            running: tDash("status.running"),
            done: tDash("status.done"),
            failed: tDash("status.failed"),
          },
        }}
      />
    </div>
  );
}
