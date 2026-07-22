-- 도메인별 검사 제외 규칙 (오탐 관리)
-- 소유자가 대시보드에서 지정한 규칙 id는 이후 자동 검사에서 위반으로 집계되지 않는다.
-- 적용 시점: 검사 실행 시 (기존 보고서는 소급 변경되지 않음 — summary.excludedRules에 기록)
alter table public.domains
  add column if not exists disabled_rules text[] not null default '{}';

comment on column public.domains.disabled_rules is
  '자동 검사에서 제외할 규칙 id 목록 (오탐 관리 — 대시보드에서 소유자가 설정, 검사 실행 시 적용)';
