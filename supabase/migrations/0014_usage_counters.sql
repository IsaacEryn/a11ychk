-- 0014: 활용 지표 카운터 (임팩트 페이지용)
-- AI 수정 요청 다운로드 등 이벤트성 지표를 키별로 집계한다.
create table if not exists public.usage_counters (
  key text primary key,
  count bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- RLS 활성 + 정책 없음 = service role 전용 (임팩트 페이지는 서버에서 집계만 노출)
alter table public.usage_counters enable row level security;

create or replace function public.increment_usage_counter(p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.usage_counters (key, count, updated_at)
  values (p_key, 1, now())
  on conflict (key) do update set count = usage_counters.count + 1, updated_at = now();
$$;

revoke all on function public.increment_usage_counter(text) from public;
grant execute on function public.increment_usage_counter(text) to service_role;
