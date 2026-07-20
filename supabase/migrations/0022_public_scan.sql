-- 공개 지정 보고서: 도메인별로 "공개할 특정 검사"를 고정한다. Supabase SQL Editor에서 실행.
--
-- 배경: 지금까지 배지·디렉터리·/site 링크는 항상 "최신 완료 검사"를 런타임에 골랐다.
-- 사용자가 대표 보고서를 직접 지정하고 싶어 하므로, 지정 시 그 검사를 우선 쓰고(배지 값·링크·
-- 디렉터리), 미지정(null)이면 기존대로 최신 완료 검사로 폴백한다.
-- 지정 검사가 삭제되면 on delete set null로 자동 폴백된다.

alter table public.domains
  add column if not exists public_scan_id uuid references public.scans (id) on delete set null;
