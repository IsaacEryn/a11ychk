import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * www.만 접어 apex와 동일하게 취급. 등록 도메인(codeslog.com)과 검사 URL(www.codeslog.com)이
 * 어긋나도 같은 사이트로 매칭하기 위한 공통 규칙 — 대시보드 추이·배지·디렉터리·site 리다이렉트 공용.
 */
export function foldHost(h: string): string {
  return h.toLowerCase().replace(/^www\./, "");
}

/** scan.root_url의 호스트가 도메인 호스트와 (www 무관) 같은지 */
export function scanUrlMatchesHost(rootUrl: string, domainHost: string): boolean {
  try {
    return foldHost(new URL(rootUrl).hostname) === foldHost(domainHost);
  } catch {
    return false;
  }
}

/**
 * 도메인 소유자의 최신 완료 검사를 www/apex 무관하게 찾는다.
 * scans.domain_id는 과거 www/apex 불일치로 null일 수 있어(정확 hostname 매칭의 한계),
 * root_url 호스트를 접어서 매칭한다. columns에는 반드시 root_url을 포함할 것(JS 검증용).
 */
export async function findLatestDoneScanForHost<T extends { root_url?: string | null }>(
  admin: SupabaseClient,
  userId: string,
  domainHost: string,
  columns: string,
): Promise<T | null> {
  const apex = foldHost(domainHost);
  const { data } = await admin
    .from("scans")
    .select(columns)
    .eq("user_id", userId)
    .eq("status", "done")
    .ilike("root_url", `%${apex}%`) // 서버측 1차 좁히기(부분일치) → 아래서 정확 검증
    .order("finished_at", { ascending: false })
    .limit(20)
    .then((r) => r, () => ({ data: null }));
  for (const row of ((data ?? []) as unknown) as T[]) {
    if (row.root_url && scanUrlMatchesHost(row.root_url, domainHost)) return row;
  }
  return null;
}

/**
 * 도메인의 "공개 대상 검사"를 반환한다.
 * public_scan_id가 지정돼 있으면 그 검사(소유자·done 확인)를, 없거나 무효(삭제·미완료)면
 * 최신 완료 검사로 폴백한다. 배지·/site·디렉터리 공용.
 */
export async function getDomainPublicScan<T extends { root_url?: string | null }>(
  admin: SupabaseClient,
  domain: { user_id: string; hostname: string; public_scan_id?: string | null },
  columns: string,
): Promise<T | null> {
  if (domain.public_scan_id) {
    const { data } = await admin
      .from("scans")
      .select(columns)
      .eq("id", domain.public_scan_id)
      .eq("user_id", domain.user_id)
      .eq("status", "done")
      .maybeSingle()
      .then((r) => r, () => ({ data: null }));
    if (data) return (data as unknown) as T;
    // 지정 검사가 삭제/미완료 → 최신으로 폴백
  }
  return findLatestDoneScanForHost<T>(admin, domain.user_id, domain.hostname, columns);
}
