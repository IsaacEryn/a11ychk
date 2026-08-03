import { redirect } from "next/navigation";
import { adminBasePath } from "@/lib/adminSlug";

/** 구 검사 로그 경로 — 로그 하위로 이동됨. 필터 쿼리를 보존해 리다이렉트 */
export default async function LegacyAdminScansPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams(
    Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"),
  ).toString();
  redirect(`${adminBasePath(locale)}/logs/scans${qs ? `?${qs}` : ""}`);
}
