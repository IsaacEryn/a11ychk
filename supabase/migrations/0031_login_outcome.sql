-- ═══════════════════════════════════════════════════════════════
-- 로그인 기록에 결과 구분 추가 — 관리자 로그인 이상 징후 감지용
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════
-- success    = 로그인 성공 (기존 행은 전부 이 값)
-- mfa_failed = 2단계 인증(TOTP) 실패 — 비밀번호는 통과한 시도라 위험 신호가 크다
--
-- 관리자 로그인 알림을 "매번"에서 "이상 징후가 있을 때"로 바꾸기 위해,
-- 익숙한 IP·기기 판단(성공 이력)과 실패 누적 판단에 이 컬럼을 쓴다.

alter table public.login_logs
  add column if not exists outcome text not null default 'success'
    check (outcome in ('success', 'mfa_failed'));

-- 사용자별 최근 이력 조회(익숙한 IP·기기, 최근 실패 수) 인덱스
create index if not exists login_logs_user_outcome_idx
  on public.login_logs (user_id, outcome, created_at desc);
