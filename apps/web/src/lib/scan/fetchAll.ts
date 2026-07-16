import "server-only";

/**
 * Supabase range 페이지네이션으로 전량 조회.
 * PostgREST 기본 max-rows(1000)나 명시적 limit로 인한 조용한 절단을 방지한다 —
 * 절단된 findings로 재집계하면 준수율이 왜곡된다.
 */
export async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}
