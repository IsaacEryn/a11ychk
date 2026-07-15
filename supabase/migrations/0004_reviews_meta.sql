-- ═══════════════════════════════════════════════════════════════
-- 평가 워크벤치: 점검자 판정 기입(scan_reviews) + 보고서 메타(report_meta)
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 보고서 메타 정보 (사이트 이름·기관·평가자·제목·총평)
alter table public.scans
  add column if not exists report_meta jsonb;

-- 점검자 판정: 스캔×기준(WCAG SC 또는 KWCAG 항목)별 수동 판정 + 관찰 메모
create table if not exists public.scan_reviews (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans (id) on delete cascade,
  standard text not null check (standard in ('wcag', 'kwcag')),
  item_id text not null,
  outcome text not null check (outcome in ('passed', 'failed', 'cannotTell', 'notPresent', 'notChecked')),
  note text not null default '' check (char_length(note) <= 5000),
  updated_at timestamptz not null default now(),
  unique (scan_id, standard, item_id)
);
create index if not exists scan_reviews_scan_idx on public.scan_reviews (scan_id);

alter table public.scan_reviews enable row level security;

-- 스캔 소유자는 자기 스캔의 리뷰를 모두 관리, 관리자는 조회
create policy "scan_reviews_select_own" on public.scan_reviews
  for select using (
    exists (
      select 1 from public.scans s
      where s.id = scan_id and (s.user_id = (select auth.uid()) or public.is_admin())
    )
  );
create policy "scan_reviews_insert_own" on public.scan_reviews
  for insert with check (
    exists (select 1 from public.scans s where s.id = scan_id and s.user_id = (select auth.uid()))
  );
create policy "scan_reviews_update_own" on public.scan_reviews
  for update using (
    exists (select 1 from public.scans s where s.id = scan_id and s.user_id = (select auth.uid()))
  );
create policy "scan_reviews_delete_own" on public.scan_reviews
  for delete using (
    exists (select 1 from public.scans s where s.id = scan_id and s.user_id = (select auth.uid()))
  );
