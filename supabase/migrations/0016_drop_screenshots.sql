-- 위반 요소 스크린샷 기능 제거 (실효성 낮아 롤백) — 0015 되돌림.
-- Supabase SQL Editor에서 실행. 순서: 스토리지 객체 삭제 → 버킷 → 컬럼·함수.

-- 1) 스토리지 객체 접근 차단 (public URL 404). 실제 바이트 정리는 별도 스크립트로 remove 처리됨.
delete from storage.objects where bucket_id = 'shots';
delete from storage.buckets where id = 'shots';

-- 2) 스키마 되돌림
drop function if exists public.shots_total_bytes();
alter table public.findings drop column if exists screenshot_path;
alter table public.scans drop column if exists shots_bytes;
