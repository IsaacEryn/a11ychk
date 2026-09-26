-- 정기 검사 후보를 SQL에서 고른다 — 주기별 기한 판정 + 계정당 1개 + 기한 초과 시간 순.
-- Supabase SQL Editor에서 실행. 코드는 이 함수가 없으면 예전 방식(창 500 + JS 선택)으로 폴백한다.
--
-- 왜: 크론이 "20시간 지난 도메인을 last 오름차순으로 N개" 가져온 뒤 JS에서 기한·계정 중복을 거르면,
-- 기한 전인 주간·월간 도메인이나 한 계정의 형제 도메인이 창을 채워 다른 계정의 정기 검사가 멈춘다
-- (다관점 검토 V1). 계정 중복 제거와 기한 판정을 조회 단계로 옮기면 창 포화가 구조적으로 사라진다.
-- 간격(시간)은 apps/web/src/lib/scan/schedule.ts의 FREQUENCY_HOURS와 같아야 한다(daily 20 · weekly 156 · monthly 648).

create or replace function public.scheduled_scan_candidates(p_limit int)
returns setof public.domains
language sql
stable
set search_path = ''
as $$
  with ranked as (
    select d.id,
           d.user_id,
           -- 기한 초과 시간(초). 한 번도 안 돈 도메인이 가장 앞.
           case when d.last_auto_scan_at is null then 'infinity'::float8
                else extract(epoch from (now() - d.last_auto_scan_at))::float8
                     - (case d.scan_frequency when 'weekly' then 156 when 'monthly' then 648 else 20 end) * 3600
           end as overdue_s
      from public.domains d
     where d.auto_scan and d.verified
  ),
  per_user as (
    select distinct on (user_id) id, overdue_s
      from ranked
     where overdue_s >= 0
     order by user_id, overdue_s desc
  ),
  top as (
    select id, overdue_s from per_user order by overdue_s desc limit greatest(p_limit, 0)
  )
  select d.*
    from public.domains d
    join top on top.id = d.id
   order by top.overdue_s desc;
$$;

revoke all on function public.scheduled_scan_candidates(int) from public, anon, authenticated;
grant execute on function public.scheduled_scan_candidates(int) to service_role;
