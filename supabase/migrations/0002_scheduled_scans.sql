-- ═══════════════════════════════════════════════════════════════
-- 정기 스캔: 소유 확인된 도메인을 주기적으로 자동 검사
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

alter table public.domains
  add column if not exists auto_scan boolean not null default false,
  add column if not exists last_auto_scan_at timestamptz;

-- 크론이 대상 도메인을 빠르게 찾도록
create index if not exists domains_auto_scan_idx
  on public.domains (auto_scan) where auto_scan = true;
