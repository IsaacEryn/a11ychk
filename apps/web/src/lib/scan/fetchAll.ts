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
    // 조회 오류를 "끝"으로 취급하면 부분 결과가 완전한 결과처럼 흘러가고,
    // 보고서 캐시나 재집계된 summary에 그대로 굳는다. 호출자가 알게 던진다.
    if (error) throw new Error(`행 조회 실패(offset ${from}): ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}
