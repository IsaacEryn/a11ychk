-- 검사 큐: 전역 동시 실행 상한을 원자적으로 강제하는 claim 함수 + 큐 순서 인덱스.
-- Supabase SQL Editor에서 실행.
--
-- 배경: 검사는 무거운(헤드리스 크로미엄) 작업인데 시스템 전역 동시성 상한이 없어,
-- 서로 다른 사용자가 동시에 많이 시작하면 함수 메모리·동시성 한계에서 무너진다.
-- 이 함수로 "동시에 running인 검사 수 <= p_cap"을 보장하고 나머지는 queued로 대기시킨다.

-- queued 순서 조회용 부분 인덱스 (오래된 순으로 꺼냄)
create index if not exists scans_queue_idx on public.scans (created_at) where status = 'queued';

-- 남은 용량(p_cap - running)만큼 oldest queued 검사를 원자적으로 running으로 claim.
-- pg_advisory_xact_lock으로 "running 카운트 → claim"을 직렬화해 동시 드레인이
-- 용량을 초과 claim하지 못하게 한다(트랜잭션 종료 시 락 자동 해제).
-- for update skip locked: 이미 다른 트랜잭션이 잠근 행은 건너뛰어 경합을 피한다.
create or replace function public.claim_scans(p_cap int)
returns table (id uuid)
language plpgsql
as $$
declare
  avail int;
begin
  perform pg_advisory_xact_lock(hashtext('a11ychk_scan_drain'));
  select p_cap - count(*) into avail from public.scans where status = 'running';
  if avail is null or avail <= 0 then
    return;
  end if;
  return query
  update public.scans s
  set status = 'running', started_at = now()
  where s.id in (
    select q.id from public.scans q
    where q.status = 'queued'
    order by q.created_at asc
    limit avail
    for update skip locked
  )
  returning s.id;
end;
$$;

-- 서비스 롤(관리자 클라이언트)만 호출 — anon/authenticated에는 실행 권한 없음
revoke all on function public.claim_scans(int) from public, anon, authenticated;
