-- ═══════════════════════════════════════════════════════════════
-- 비로그인 맛보기 검사 통계 (관리자 전용 집계 데이터)
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 맛보기 검사 1건당 요약 1행 — 통계 목적(도메인별 수요·평균 준수율·볼륨).
-- 개인정보 없음: URL 경로·쿼리는 버리고 호스트명만, IP·사용자 연결 없음.
-- 소비자는 결과를 다시 볼 수 없으며(화면 1회성 유지), 관리자 통계에만 쓰인다.
create table if not exists public.teaser_scans (
  id uuid primary key default gen_random_uuid(),
  hostname text not null,
  rate numeric(5, 1) not null,
  rule_count int not null default 0,
  node_count int not null default 0,
  by_impact jsonb not null default '{}'::jsonb,
  locale text not null default 'ko',
  created_at timestamptz not null default now()
);

alter table public.teaser_scans enable row level security;
-- 정책 없음 — 기록·조회 모두 앱 서버(service role) 경유, 관리자 페이지에서만 표시

comment on table public.teaser_scans is
  '비로그인 맛보기 검사 통계 (service role 전용, RLS 정책 0개) — 호스트명·요약 수치만, 개인정보 없음';

create index if not exists teaser_scans_created_at_idx on public.teaser_scans (created_at desc);
create index if not exists teaser_scans_hostname_idx on public.teaser_scans (hostname);
