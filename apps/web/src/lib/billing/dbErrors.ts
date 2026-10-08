/**
 * 0041 미적용(테이블 없음) — Postgres 42P01, PostgREST 스키마 캐시 PGRST205.
 * 운영 오류가 아니라 적용 순서 문제라 기록 없이 안내만 한다.
 */
export const isMissingTable = (e?: { code?: string } | null) => e?.code === "42P01" || e?.code === "PGRST205";
