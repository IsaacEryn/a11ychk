-- ═══════════════════════════════════════════════════════════════
-- 서버 오류 로그 (app_errors) — 자체 에러 모니터링
-- Next.js instrumentation onRequestError 훅이 service role로 기록한다.
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.app_errors (
  id uuid primary key default gen_random_uuid(),
  -- Next.js 오류 digest — 같은 오류를 묶는 키
  digest text,
  message text not null,
  stack text,
  path text,
  method text,
  created_at timestamptz not null default now()
);
create index if not exists app_errors_created_idx on public.app_errors (created_at desc);
create index if not exists app_errors_digest_idx on public.app_errors (digest);

alter table public.app_errors enable row level security;
create policy "app_errors_admin_select" on public.app_errors
  for select using (public.is_admin());
-- insert 정책 없음 — service role 전용 기록

-- 30일 지난 로그는 관리자가 주기적으로 정리 (필요 시 pg_cron 대체 가능):
-- delete from public.app_errors where created_at < now() - interval '30 days';
