-- 0011: 동시성·한도 강화
-- 1) 확장 사용량 원자 증가 (한도 검사 포함) — read-then-write 레이스 제거
-- 2) 사용자당 진행 중 검사 1건 보장 (부분 유니크 인덱스) — TOCTOU 제거
-- 3) scans.summary의 scores 키만 원자 갱신 — read-merge-write 덮어쓰기 제거

-- ── 1) 확장 사용량 원자 증가 ──────────────────────────────────────────
-- 반환값: 소비 후 사용량(성공), -1(한도 초과)
create or replace function public.increment_ext_usage(p_user_id uuid, p_day date, p_limit int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count int;
begin
  if p_limit <= 0 then
    return -1;
  end if;
  insert into public.extension_usage (user_id, day, count, updated_at)
  values (p_user_id, p_day, 1, now())
  on conflict (user_id, day)
  do update set count = extension_usage.count + 1, updated_at = now()
  where extension_usage.count < p_limit
  returning count into new_count;
  -- WHERE로 갱신이 걸러지면(한도 도달) returning이 비어 null
  return coalesce(new_count, -1);
end;
$$;

revoke all on function public.increment_ext_usage(uuid, date, int) from public;
grant execute on function public.increment_ext_usage(uuid, date, int) to service_role;

-- ── 2) 사용자당 진행 중 검사 1건 ─────────────────────────────────────
-- 인덱스 생성 전에 30분 넘게 방치된 진행 상태를 정리 (Vercel maxDuration 300s를
-- 훨씬 지난 행은 죽은 검사이므로 실패로 마감해 인덱스 위반을 방지)
update public.scans
set status = 'failed',
    error = coalesce(error, '시간 초과로 자동 정리되었습니다.'),
    finished_at = coalesce(finished_at, now())
where status in ('queued', 'running')
  and created_at < now() - interval '30 minutes';

create unique index if not exists scans_one_active_per_user
  on public.scans (user_id)
  where status in ('queued', 'running');

-- ── 3) summary.scores 원자 갱신 ──────────────────────────────────────
create or replace function public.update_scan_summary_scores(p_scan_id uuid, p_scores jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.scans
  set summary = jsonb_set(coalesce(summary, '{}'::jsonb), '{scores}', p_scores)
  where id = p_scan_id;
$$;

revoke all on function public.update_scan_summary_scores(uuid, jsonb) from public;
grant execute on function public.update_scan_summary_scores(uuid, jsonb) to service_role;
