-- 관리자 로그 페이징·필터 인덱스.
--
-- scans: 관리자 검사 로그가 전역 최신순으로 페이징하는데, 기존 인덱스는
-- (user_id, created_at) 복합과 status 부분 인덱스뿐이라 데이터가 쌓이면
-- full scan + sort가 된다.
-- audit_logs: 무기한 보존(감사 목적) 테이블에 행위별 필터가 생겼다.
create index if not exists scans_created_idx on public.scans (created_at desc);
create index if not exists audit_logs_action_created_idx on public.audit_logs (action, created_at desc);
