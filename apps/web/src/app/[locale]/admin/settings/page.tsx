import { requireAdmin } from "@/lib/adminGuard";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAnnouncements, isBannerActive } from "@/lib/appSettings";
import { AnnouncementForm } from "./AnnouncementForm";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.settings")} — ${t("title")}` };
}

/**
 * 운영 설정 — 서비스 공지 관리.
 * (예전의 요금제 시행 토글·일괄 배정은 없앴다. 관리자 배정은 사용자별로 즉시 적용되고,
 *  전체 사용자를 한 번에 덮어쓰는 조작은 실수 한 번으로 개별 배정을 지워 버려 위험했다.)
 */
export default async function AdminSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드 (layout 가드만으로는 불충분)
  const t = await getTranslations("admin");

  const admin = createAdminClient();
  const activeNotice = (await getAnnouncements(admin).catch(() => [])).find((n) => isBannerActive(n)) ?? null;

  return (
    <section aria-labelledby="admin-settings-heading" className="mt-8">
      <h2 id="admin-settings-heading" className="font-display text-2xl font-bold">
        {t("settings.title")}
      </h2>

      {/* 서비스 공지 관리 — 발행 시 사이트 배너 노출 + /notices 이력 */}
      <AnnouncementForm activeTitle={activeNotice?.ko.title ?? null} activeUntil={activeNotice?.expiresAt ?? null} />
    </section>
  );
}
