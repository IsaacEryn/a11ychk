-- ═══════════════════════════════════════════════════════════════
-- 수동 검사 판정의 페이지 귀속 — 어떤 페이지에서 확인된 사항인지 기록
-- scan_reviews.pages: 관련 페이지 URL 배열(jsonb). SC별 판정은 그대로 1건 유지.
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

alter table public.scan_reviews
  add column if not exists pages jsonb;
