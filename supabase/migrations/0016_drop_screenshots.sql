-- 위반 요소 스크린샷 기능 제거 (실효성 낮아 롤백) — 0015 되돌림.
-- Supabase SQL Editor에서 실행. 스키마 정리만 수행 (모두 IF EXISTS라 재실행 안전).
-- 스토리지 객체는 이미 삭제됨. 'shots' 버킷은 비어 있으니 Storage 대시보드에서
-- 수동 삭제하거나, 그대로 두어도 무방(공개 URL은 대응 객체가 없어 404).

drop function if exists public.shots_total_bytes();
alter table public.findings drop column if exists screenshot_path;
alter table public.scans drop column if exists shots_bytes;
