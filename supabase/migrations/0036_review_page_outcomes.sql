-- ═══════════════════════════════════════════════════════════════
-- 페이지별 점검자 판정 — 여러 페이지를 한 번에 검사했을 때 항목을 페이지 단위로 판정
-- scan_reviews.page_outcomes: { "<페이지 URL>": "passed|failed|cannotTell|notPresent" }
-- 항목 판정(outcome)은 그대로 1건 유지하고, pages 컬럼은 위반(failed) 페이지 목록으로
-- 파생 저장된다 (인증 준수율 계산·기존 데이터와 하위 호환).
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

alter table public.scan_reviews
  add column if not exists page_outcomes jsonb;
