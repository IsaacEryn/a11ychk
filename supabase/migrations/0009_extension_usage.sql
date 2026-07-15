-- ═══════════════════════════════════════════════════════════════
-- 크롬 확장 사용량 (웹 검사 한도와 분리) + 페이지 출처(via)
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 확장 검사 일별 사용량 — 확장이 검사 실행 시 서버에 기록(로그인 사용자만)
create table if not exists public.extension_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.extension_usage enable row level security;
-- 본인 사용량 조회 허용, 기록은 service role 전용
create policy "extension_usage_select_own" on public.extension_usage
  for select using (user_id = (select auth.uid()) or public.is_admin());

-- 페이지 출처: 서버 스캐너(server) vs 크롬 확장(extension)
alter table public.scan_pages
  add column if not exists via text not null default 'server'
  check (via in ('server', 'extension'));
