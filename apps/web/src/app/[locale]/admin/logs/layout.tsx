import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/adminGuard";
import { adminBase } from "@/lib/adminSlug";
import { LogsNav } from "./LogsNav";

/** 로그 영역 공통 셸 — 제목 + 보조 탭(검사/로그인/감사/오류) */
export default async function AdminLogsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 렌더 스코프 캐시라 page 가드와 중복 호출해도 왕복 1회
  const t = await getTranslations("admin");

  return (
    <div className="mt-8">
      <h2 className="font-display text-2xl font-bold">{t("logs.title")}</h2>
      <LogsNav
        basePath={`${adminBase()}/logs`}
        labels={{
          label: t("logs.title"),
          scans: t("logs.tabs.scans"),
          logins: t("logs.tabs.logins"),
          audit: t("logs.tabs.audit"),
          errors: t("logs.tabs.errors"),
        }}
      />
      {children}
    </div>
  );
}
