/**
 * 0041 미적용(테이블 없음) — Postgres 42P01, PostgREST 스키마 캐시 PGRST205.
 * 운영 오류가 아니라 적용 순서 문제라 기록 없이 안내만 한다.
 * PostgREST 오류 객체와, 저장소(store.ts)가 그 코드를 달아 던진 Error 둘 다 받는다.
 */
export const isMissingTable = (e: unknown): boolean => {
  const code = e && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
  return code === "42P01" || code === "PGRST205";
};
