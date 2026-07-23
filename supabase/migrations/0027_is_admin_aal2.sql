-- ═══════════════════════════════════════════════════════════════
-- 관리자 RLS 심층 방어 — is_admin()에 2단계 인증(AAL2) 세션 요구
-- 실행: Supabase Dashboard → SQL Editor
-- ※ 반드시 관리자 계정의 TOTP 등록(웹의 2단계 인증 등록 화면)을 마친 뒤 적용할 것.
--    적용 후에는 AAL1 세션에서 관리자 RLS 정책(관리자 전체 SELECT 등)이 열리지 않는다.
--    (앱 서버는 service role이라 무영향 — 이 강화는 클라이언트 직접 쿼리 경로용.
--     본인 행 접근은 auth.uid()=id 분기가 따로 있어 일반 이용에 영향 없음)
-- ═══════════════════════════════════════════════════════════════

-- 0001의 is_admin()을 동일 시그니처로 교체 (security definer·빈 search_path 유지)
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = ''
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  )
  -- 관리자 판정은 2단계 인증까지 마친 세션(aal2)에서만 참 —
  -- 비밀번호만 탈취된 AAL1 세션으로는 관리자 정책이 열리지 않는다.
  and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;
