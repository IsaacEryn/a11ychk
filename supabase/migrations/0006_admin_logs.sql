-- ═══════════════════════════════════════════════════════════════
-- 관리 로그: 로그인 기록(login_logs) + 관리자 행위 감사(audit_logs)
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 로그인 기록 — auth 스키마는 PostgREST에 노출되지 않으므로
-- OAuth 콜백(앱 레벨)에서 service role로 기록한다.
-- email은 스냅샷: 계정 삭제(user_id set null) 후에도 행이 식별 가능하도록.
create table if not exists public.login_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  email text,
  provider text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists login_logs_created_idx on public.login_logs (created_at desc);
create index if not exists login_logs_user_idx on public.login_logs (user_id);

alter table public.login_logs enable row level security;
-- 조회는 관리자만. insert/update/delete 정책 없음 — service role 전용 기록
create policy "login_logs_admin_select" on public.login_logs
  for select using (public.is_admin());

-- 관리자 행위 감사 로그 (차단·한도 변경·요금제 토글·문의 답변 등)
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);

alter table public.audit_logs enable row level security;
create policy "audit_logs_admin_select" on public.audit_logs
  for select using (public.is_admin());
