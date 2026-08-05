-- SECURITY DEFINER 함수의 anon/authenticated 실행 권한 회수.
-- Supabase SQL Editor에서 실행.
--
-- 배경: Supabase는 프로젝트 부트스트랩에서
--   alter default privileges in schema public grant all on functions to anon, authenticated, service_role
-- 을 걸어두므로 public 스키마에 새로 만든 함수에는 anon·authenticated 직접 grant가 붙는다.
-- 0011·0014·0025가 쓴 `revoke all ... from public`은 PUBLIC 의사역할의 권한만 지우고
-- 이 직접 grant는 남긴다. 결과적으로 아래 함수들이 anon 키만으로 /rest/v1/rpc/ 호출 가능했다.
--   - update_scan_summary_scores: 소유자 검사 없이 임의 검사의 준수율 점수를 덮어쓸 수 있었다.
--     (검사 id는 공유 링크·디렉터리 경유로 비로그인 사용자에게도 노출된다)
--   - increment_teaser_usage: 'global' 카운터를 직접 올려 맛보기 검사 전역 한도를 소진시킬 수 있었다.
--   - increment_ext_usage / increment_usage_counter: 타인 확장 한도 소진·공개 지표 오염.
-- 0020(claim_scans)이 쓴 `from public, anon, authenticated` 패턴으로 통일한다.
--
-- 주의: is_admin()은 회수하지 말 것 — RLS 정책이 호출자(authenticated) 권한으로 실행한다.

revoke all on function public.update_scan_summary_scores(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.increment_ext_usage(uuid, date, int)    from public, anon, authenticated;
revoke all on function public.increment_usage_counter(text)           from public, anon, authenticated;
revoke all on function public.increment_teaser_usage(text, date, int) from public, anon, authenticated;
revoke all on function public.claim_scans(int)                        from public, anon, authenticated;

-- service role 실행 권한을 기본 권한(default privileges)에 기대지 않고 명시한다. 재실행 안전.
grant execute on function public.update_scan_summary_scores(uuid, jsonb) to service_role;
grant execute on function public.increment_ext_usage(uuid, date, int)    to service_role;
grant execute on function public.increment_usage_counter(text)           to service_role;
grant execute on function public.increment_teaser_usage(text, date, int) to service_role;
grant execute on function public.claim_scans(int)                        to service_role;
