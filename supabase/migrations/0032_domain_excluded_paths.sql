-- 도메인별 정기 검사 제외 페이지 (URL/경로 패턴)
-- 소유자가 대시보드에서 지정한 패턴은 정기(스케줄) 검사 표본에서 제외된다.
-- 크론이 검사를 만들 때 scope.excludePatterns로 주입되고, buildSample이 후보에서 뺀다.
-- 일회성 자동 검사는 폼의 scope.excludePatterns를 그대로 쓴다(이 컬럼과 무관).
alter table public.domains
  add column if not exists excluded_paths text[] not null default '{}';

comment on column public.domains.excluded_paths is
  '정기 검사에서 제외할 URL/경로 패턴 (예 /admin/*, /tag/ — 대시보드에서 소유자가 설정)';
