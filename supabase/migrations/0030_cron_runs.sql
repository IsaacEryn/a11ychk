-- ═══════════════════════════════════════════════════════════════
-- 크론 실행 기록 — "정기 작업이 조용히 안 도는 상황"을 감지하기 위한 관측 테이블
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════
-- app_errors는 오류 전용이라 정상 실행 기록을 섞으면 오류 목록·신규 오류 메일
-- dedupe가 오염된다 — 성공/실패/소요/요약을 구조화해 별도 보관한다.
-- ok가 null인 행 = 시작만 기록되고 마감되지 못한 실행(크래시·강제 종료).

create table if not exists public.cron_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,                     -- 'scheduled-scans' | 'repo-stats'
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  summary jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cron_runs_job_started_idx on public.cron_runs (job, started_at desc);

-- 정책 없음 = service role 전용 (app_errors와 동일 관례)
alter table public.cron_runs enable row level security;

comment on table public.cron_runs is
  '크론 실행 기록 (service role 전용, RLS 정책 0개) — 무실행 감지·관리자 대시보드 표시용, 90일 보존';
