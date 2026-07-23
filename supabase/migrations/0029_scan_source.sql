-- ═══════════════════════════════════════════════════════════════
-- 검사 생성 경로 구분 — 관리자 검사 로그의 수동/자동/정기 표시용
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════
-- user      = 사용자가 직접 실행 (수동/자동 구분은 scope.manualPages 유무로)
-- scheduled = 정기 검사 크론이 생성
-- 기존 행은 생성 주체를 소급 판별할 수 없어 기본값 user로 남는다.

alter table public.scans
  add column if not exists source text not null default 'user'
    check (source in ('user', 'scheduled'));
