import { redirect } from "next/navigation";
import { adminBasePath } from "@/lib/adminSlug";

/** /logs 인덱스 — 첫 보조 탭(검사)으로. 데이터 조회가 없어 가드는 도착지 page가 맡는다 */
export default async function AdminLogsIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`${adminBasePath(locale)}/logs/scans`);
}
