-- 공개 디렉터리 opt-in 등재 (투명성 배지·공개 목록)
-- Supabase SQL Editor에서 실행. 코드는 컬럼 부재 관용이라 배포 순서 무관.

alter table public.domains
  add column public_listed boolean not null default false,  -- 사용자 opt-in 공개 등재
  add column listed_at timestamptz;                          -- 등재 시점(증적)

-- 공개 목록 집계용 부분 인덱스 (등재된 도메인만)
create index if not exists domains_public_listed_idx
  on public.domains (public_listed) where public_listed;
