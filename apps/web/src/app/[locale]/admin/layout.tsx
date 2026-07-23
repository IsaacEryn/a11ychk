import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/adminGuard";
import { adminBase } from "@/lib/adminSlug";
import { AdminNav } from "./AdminNav";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("title"), robots: { index: false } };
}

/** 관리자 영역 공통 레이아웃 — 가드(role 검증) + 하위 내비게이션 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  // 관리자 확인 (RLS와 별개로 서버에서 role 검증) — UX용 1차 가드.
  // 주의: layout 가드만으로는 병렬 렌더되는 page의 데이터가 보호되지 않는다 —
  // 모든 admin page가 requireAdmin을 직접 호출한다(렌더 스코프 캐시로 왕복 1회).
  await requireAdmin(locale);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <AdminNav
        basePath={adminBase()}
        labels={{
          label: t("nav.label"),
          dashboard: t("nav.dashboard"),
          users: t("nav.users"),
          referrals: t("nav.referrals"),
          teaser: t("nav.teaser"),
          scans: t("nav.scans"),
          inquiries: t("nav.inquiries"),
          settings: t("nav.settings"),
          logs: t("nav.logs"),
        }}
      />
      {children}
    </div>
  );
}
