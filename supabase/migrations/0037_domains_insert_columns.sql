-- domains INSERT를 (user_id, hostname) 컬럼으로 한정.
-- Supabase SQL Editor에서 실행. 코드 변경 없이 적용 가능(addDomain은 이 두 컬럼만 넣는다).
--
-- 배경: domains_insert_own 정책(0001)은 user_id만 검사하고, Supabase 부트스트랩이
-- authenticated에 테이블 INSERT를 통째로 준다. 그래서 로그인 사용자가 anon 키와 자기 세션으로
-- /rest/v1/domains에 verified=true·auto_scan=true·public_listed=true인 행을 직접 넣을 수 있었다.
-- 위조한 "소유 확인"으로 남의 사이트에 대해 받을 수 있던 것:
--   - 공개 디렉터리 등재·임베드 배지·/site 페이지의 "소유 확인" 표시 (0018부터)
--   - 소유 확인 표본 크기(검사 페이지 한도 상향)
--   - 정기 검사 대상 자격(크론은 verified=true만 검사하고 정기 검사는 사용자 한도를 쓰지 않는다)
--   - last_auto_scan_at=null로 넣으면 크론 후보 정렬의 맨 앞
--   - 직접 입력 표본의 robots.txt 예외(소유 확인 사용자는 robots와 관계없이 검사)
--   - verify_token을 남의 사이트에 게시된 값으로 넣은 뒤 정상 소유 확인을 통과하는 것(토큰 복사)
-- 소유 확인·정기 검사·공개 설정은 모두 서버(service role)가 소유자 검증 뒤에 갱신한다.
-- 사용자 클라이언트가 domains에 쓰는 경로는 addDomain의 {user_id, hostname} insert와
-- deleteDomain의 본인 행 delete뿐이다(UPDATE 정책은 없다).
--
-- ⚠ addDomain에 insert 컬럼을 추가하면 여기 grant도 같이 넓혀야 한다(안 그러면 42501로 조용히 "failed").

revoke insert on public.domains from anon, authenticated;
grant insert (user_id, hostname) on public.domains to authenticated;

-- 방어 심층: 콘솔 조작 등으로 테이블 INSERT grant가 다시 붙어도 서버 전용 컬럼은 기본값으로 강제.
-- PostgREST가 anon·authenticated 역할로 전환한 요청만 대상 — service role(서버)과 SQL Editor는 통과.
create or replace function public.domains_force_server_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.verified := false;
    new.verify_token := encode(extensions.gen_random_bytes(16), 'hex');
    new.public_scan_id := null;
    new.verify_method := null;
    new.auto_scan := false;
    new.last_auto_scan_at := null;
    new.public_listed := false;
    new.listed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.domains_force_server_columns() from public, anon, authenticated;

drop trigger if exists domains_force_server_columns on public.domains;
create trigger domains_force_server_columns
  before insert on public.domains
  for each row execute function public.domains_force_server_columns();

-- ── 적용 확인 ──
-- select grantee, column_name from information_schema.column_privileges
--  where table_schema = 'public' and table_name = 'domains' and privilege_type = 'INSERT'
--  order by grantee, column_name;
--   → authenticated는 hostname, user_id 두 줄만 나와야 한다.
--
-- ── 이미 들어간 위조 행 점검 (적용 후 한 번) ──
-- 위조자는 verify_method까지 채울 수 있었으므로 SQL만으로는 가려낼 수 없다. 아래는 의심 목록이고,
-- 확실히 하려면 verified 행 전체를 서버의 소유 확인(detectVerification)으로 한 번 재확인해야 한다.
-- 1) 등급 상한보다 소유 확인 도메인이 많은 계정 (free 1 · plus2 2 · pro 3 · ent 10, override 제외)
-- select d.user_id, count(*) as verified_domains, p.earned_plan, p.scan_limit_override
--   from public.domains d join public.profiles p on p.id = d.user_id
--  where d.verified group by d.user_id, p.earned_plan, p.scan_limit_override
-- having count(*) > 1 order by 2 desc;
-- 2) 소유 확인 방법 기록이 없는 소유 확인 도메인 (정상 경로는 항상 verify_method를 남긴다)
-- select id, user_id, hostname, created_at from public.domains where verified and verify_method is null;
-- 3) 토큰 복사 — 같은 verify_token을 가진 행(정상 토큰은 무작위 16바이트라 겹치지 않는다)과
--    형식이 기본값(32자 소문자 hex)이 아닌 토큰
-- select verify_token, array_agg(hostname || ' / ' || user_id) from public.domains
--  group by verify_token having count(*) > 1;
-- select id, user_id, hostname from public.domains where verify_token !~ '^[0-9a-f]{32}$';
-- 4) 확실히 하려면 verified 행 전체를 서버의 소유 확인(detectVerification)으로 한 번 재확인한다.
