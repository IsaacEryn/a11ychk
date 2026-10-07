-- ═══════════════════════════════════════════════════════════════
-- 확장으로 만든 보고서를 웹 검사 한도에서 분리
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════
-- 크롬 확장이 "새 보고서"로 저장한 검사는 확장 전용 일일 한도(extension_usage)를 이미
-- 원자적으로 차감한다. 그런데 scans.source가 기본값 'user'로 들어가 웹 검사 한도
-- (checkQuota)에서도 한 번 더 세어졌다. 확장 보고서를 'extension'으로 표시해 분리한다.

-- 0029가 add column 안에서 만든 이름 없는 check 제약을 찾아 지운다(자동 이름에 기대지 않음)
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.scans'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.scans drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.scans
  add constraint scans_source_check check (source in ('user', 'scheduled', 'extension'));

-- 백필 — 확장이 새로 만든 보고서만: 웹 검사는 항상 scope를 저장하고, 확장 보고서는
-- scope 없이 페이지 1개로 시작한다. 웹 검사에 확장 결과를 덧붙인(병합) 보고서는
-- scope가 있으므로 건드리지 않는다.
update public.scans s
set source = 'extension'
where s.source = 'user'
  and s.scope is null
  and s.page_limit = 1
  and exists (
    select 1 from public.scan_pages p where p.scan_id = s.id and p.via = 'extension'
  );
