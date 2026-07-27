-- 검사 옵션 프리셋 — 자주 검사하는 사이트의 옵션 세트를 이름 붙여 저장/불러오기.
-- 사용자 소유(user_id), 도메인 무관. 검사 폼(/scan)에서 저장·불러오기한다.
-- 개수 제한은 애플리케이션(quota.presetLimit)에서 등급별로 강제한다.
create table if not exists public.scan_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  options jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists scan_presets_user_idx on public.scan_presets (user_id);

alter table public.scan_presets enable row level security;

-- 소유자 전용 CRUD (admin은 조회만). update는 using + with check 둘 다 둔다.
create policy "scan_presets_select_own" on public.scan_presets
  for select using ((select auth.uid()) = user_id or public.is_admin());
create policy "scan_presets_insert_own" on public.scan_presets
  for insert with check ((select auth.uid()) = user_id);
create policy "scan_presets_update_own" on public.scan_presets
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "scan_presets_delete_own" on public.scan_presets
  for delete using ((select auth.uid()) = user_id);

comment on table public.scan_presets is '사용자별 검사 옵션 프리셋 (검사 폼 옵션 세트 저장/불러오기)';
