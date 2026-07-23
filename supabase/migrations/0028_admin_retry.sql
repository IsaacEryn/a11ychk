-- ═══════════════════════════════════════════════════════════════
-- 관리자 재검사 표식 + 사용자 노출 분리
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 관리자가 실행한 재검사 표식 — 사용자 검사 한도 카운트에서 제외되고,
-- 성공(done)한 경우에만 해당 사용자에게 노출된다(실패는 관리자 전용).
alter table public.scans add column if not exists admin_retry boolean not null default false;

comment on column public.scans.admin_retry is
  '관리자 재검사 여부 — 한도 미차감, done일 때만 소유 사용자에게 노출(실패는 관리자만)';

-- 사용자 SELECT 정책 교체: 본인 검사 중 관리자 재검사는 done일 때만 보인다.
-- (dashboard·mypage·검사 상세·보고서 등 user client 경로가 RLS로 일괄 반영됨)
drop policy if exists "scans_select_own" on public.scans;
create policy "scans_select_own" on public.scans
  for select using (
    ((select auth.uid()) = user_id and (not admin_retry or status = 'done'))
    or public.is_admin()
  );

-- scan_pages·findings 정책은 소유 조건을 자체 복제하므로(0001) 동일 조건으로 교체 —
-- 실패한 관리자 재검사의 하위 데이터(페이지·위반)도 사용자 직접 쿼리에서 차단한다.
drop policy if exists "scan_pages_select_own" on public.scan_pages;
create policy "scan_pages_select_own" on public.scan_pages
  for select using (
    exists (
      select 1 from public.scans s
      where s.id = scan_id
        and ((s.user_id = (select auth.uid()) and (not s.admin_retry or s.status = 'done'))
             or public.is_admin())
    )
  );

drop policy if exists "findings_select_own" on public.findings;
create policy "findings_select_own" on public.findings
  for select using (
    exists (
      select 1 from public.scan_pages p
      join public.scans s on s.id = p.scan_id
      where p.id = scan_page_id
        and ((s.user_id = (select auth.uid()) and (not s.admin_retry or s.status = 'done'))
             or public.is_admin())
    )
  );
