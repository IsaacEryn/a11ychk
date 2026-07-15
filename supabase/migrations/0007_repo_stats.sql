-- ═══════════════════════════════════════════════════════════════
-- GitHub 저장소 통계 일별 축적 (repo_stats)
-- GitHub Insights 트래픽 API는 최근 14일만 제공하므로, 크론이 매일
-- 14일치를 upsert해 무기한 히스토리를 쌓는다. /impact 페이지의 근거 데이터.
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.repo_stats (
  date date primary key,
  views int not null default 0,
  unique_views int not null default 0,
  clones int not null default 0,
  unique_clones int not null default 0,
  -- 수집 시점 스냅샷 (그날 크론이 돈 경우에만 기록)
  stars int,
  forks int,
  updated_at timestamptz not null default now()
);

alter table public.repo_stats enable row level security;
-- 정책 없음 — service role 전용 (impact 페이지는 서버에서 집계 수치만 노출)
