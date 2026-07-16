-- 0013: 정기 스캔 결과 이메일 알림 설정
-- auto_scan 도메인에서 준수율 하락·새 위반 발견 시 소유자에게 알림 (기본 켜짐, 도메인별 끄기 가능)
alter table public.domains add column if not exists notify boolean not null default true;
