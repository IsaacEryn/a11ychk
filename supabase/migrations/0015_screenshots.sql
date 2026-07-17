-- 위반 요소 스크린샷 (보고서 실증 강화)
-- 가드레일: 스캔당 10장·규칙당 1장(critical/serious만)·JPEG q60 클립,
-- 보존 free 10일 / pro 90일 / enterprise 365일, 전역 예산 700MB (크론이 집행)

-- 대표 위반 요소의 캡처 경로 (storage 'shots' 버킷 내, 파일명은 128비트 난수)
alter table public.findings add column if not exists screenshot_path text;

-- 스캔별 캡처 총 바이트 — 전역 예산 계산용 자체 회계 (storage API 순회 없이 합산)
alter table public.scans add column if not exists shots_bytes bigint not null default 0;

-- 공개 버킷: 경로가 난수라 추측 불가, 쓰기는 service role만 (별도 정책 불필요)
insert into storage.buckets (id, name, public)
values ('shots', 'shots', true)
on conflict (id) do nothing;

-- 전역 예산 집계 (관리자 대시보드·크론 공용)
create or replace function public.shots_total_bytes()
returns bigint
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(shots_bytes), 0)::bigint from public.scans
$$;
