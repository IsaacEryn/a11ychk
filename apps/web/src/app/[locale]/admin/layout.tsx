import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  // 관리자 확인 (RLS와 별개로 서버에서 role 검증) — 모든 하위 페이지에 공통 적용
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") redirect(`/${locale}/dashboard`);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <AdminNav
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
