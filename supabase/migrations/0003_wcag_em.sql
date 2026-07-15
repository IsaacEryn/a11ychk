-- ═══════════════════════════════════════════════════════════════
-- WCAG-EM 방법론 정렬: 평가 범위·표본 메타데이터 + 앱 설정
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 스캔에 WCAG-EM Step 1 평가 범위 저장
alter table public.scans
  add column if not exists scope jsonb;

-- 페이지에 WCAG-EM Step 2·3 표본 메타데이터
alter table public.scan_pages
  add column if not exists category text,
  add column if not exists sample_type text check (sample_type in ('structured', 'random', 'process')),
  add column if not exists technologies jsonb;

-- 앱 전역 설정 (요금제 시행 활성 여부 등). service role만 기록.
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
-- 공개 읽기 허용 (요금제 활성 여부 등 비민감 설정). 쓰기는 service role 전용.
create policy "app_settings_public_read" on public.app_settings
  for select using (true);

-- 요금제 시행 기본값: 비활성 (전원 free 등급 적용)
insert into public.app_settings (key, value)
values ('plans', '{"active": false}')
on conflict (key) do nothing;
