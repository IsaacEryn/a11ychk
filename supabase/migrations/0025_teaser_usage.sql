-- ═══════════════════════════════════════════════════════════════
-- 비로그인 맛보기 검사 사용량 (IP 해시 + 전역 캡 원자 카운터)
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 맛보기 검사 일별 사용량 — ip_hash는 sha256(salt+IP), 원본 IP는 저장하지 않는다.
-- 전역 일일 캡은 ip_hash='global' sentinel 행으로 같은 테이블에서 관리.
-- 행은 크론이 2일 경과분을 삭제한다(개인정보 최소화 + 테이블 크기 억제).
create table if not exists public.teaser_usage (
  ip_hash text not null,
  day date not null,
  count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (ip_hash, day)
);

alter table public.teaser_usage enable row level security;
-- 정책 없음 — 조회·기록 모두 앱 서버(service role) 경유

comment on table public.teaser_usage is
  '비로그인 맛보기 검사 사용량 (service role 전용, RLS 정책 0개) — ip_hash=global 행은 전역 일일 캡';

-- 원자 증가 + 한도 검사 (increment_ext_usage[0011]와 동일 패턴)
-- 반환값: 소비 후 사용량(성공), -1(한도 초과)
create or replace function public.increment_teaser_usage(p_ip_hash text, p_day date, p_limit int)
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
  insert into public.teaser_usage (ip_hash, day, count, updated_at)
  values (p_ip_hash, p_day, 1, now())
  on conflict (ip_hash, day)
  do update set count = teaser_usage.count + 1, updated_at = now()
  where teaser_usage.count < p_limit
  returning count into new_count;
  -- WHERE로 갱신이 걸러지면(한도 도달) returning이 비어 null
  return coalesce(new_count, -1);
end;
$$;

revoke all on function public.increment_teaser_usage(text, date, int) from public;
grant execute on function public.increment_teaser_usage(text, date, int) to service_role;
