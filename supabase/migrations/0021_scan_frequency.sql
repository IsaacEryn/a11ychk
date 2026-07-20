-- 정기 검사 주기: 도메인별로 매일/매주/매월 중 선택. Supabase SQL Editor에서 실행.
--
-- 배경: 기존 정기 검사는 auto_scan 켜진 도메인을 하루 1회 크론에서 무조건 검사했다(사실상 매일).
-- 이 컬럼으로 도메인별 주기를 두어, 매주·매월 도메인은 그 주기가 됐을 때만 검사한다.
-- 미적용 환경에서도 앱은 'daily' 기본으로 동작한다(컬럼 없으면 undefined→daily 폴백).

alter table public.domains
  add column if not exists scan_frequency text not null default 'daily'
  check (scan_frequency in ('daily', 'weekly', 'monthly'));
