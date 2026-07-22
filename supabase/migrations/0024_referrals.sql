-- ═══════════════════════════════════════════════════════════════
-- 사용자 초대 → 등급 자동 승급 (referrals + profiles 초대 컬럼 3종)
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 초대 원장 — service role 전용 (RLS 활성 + 정책 0개: PostgREST 직접 접근 전면 차단.
-- 마이페이지·관리자 화면 모두 서버에서 admin client로만 조회한다)
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  -- 피초대자 — 탈퇴해도 행은 보존(재가입 남용 판별 근거), 링크만 끊는다
  invitee_id uuid references public.profiles (id) on delete set null,
  -- sha256(REFERRAL_HASH_SECRET + 정규화 이메일) hex — 원문 미보관.
  -- 전역 unique: 같은 이메일은 서비스 전체에서 1회만 초대가 기록됨(탈퇴 후 재가입 반복 차단)
  invitee_email_hash text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'valid', 'suspect', 'rejected')),
  suspect_reason text, -- 'same_ip' | 'cap' 등 (앱 레벨 관리)
  appeal_note text,    -- 초대자 소명 (suspect → 관리자 심사)
  signup_ip text,      -- 피초대자 가입 시점 IP 스냅샷 (부정 이용 판별 — 90일 후 크론이 비움)
  created_at timestamptz not null default now(),
  validated_at timestamptz
);

create index if not exists referrals_referrer_status_idx on public.referrals (referrer_id, status);
create index if not exists referrals_invitee_idx on public.referrals (invitee_id);
-- 당일 성립 수(velocity)·총 성립 상한(20) 집계용
create index if not exists referrals_referrer_validated_idx
  on public.referrals (referrer_id, validated_at) where status = 'valid';

alter table public.referrals enable row level security;
-- 정책 없음 — 조회·기록 모두 앱 서버(service role) 경유

comment on table public.referrals is '사용자 초대 원장 (service role 전용, RLS 정책 0개)';
comment on column public.referrals.invitee_email_hash is 'sha256(salt+정규화 이메일) — 전역 1회만 기록';
comment on column public.referrals.signup_ip is '가입 시점 IP 스냅샷 (부정 이용 판별 — 개인정보처리방침 고지, 90일 후 파기)';

-- profiles: 초대 코드(마이페이지 접근 시 lazy 생성) + 달성 등급 + 피초대자 일 한도 보너스
alter table public.profiles
  add column if not exists referral_code text unique,
  add column if not exists earned_plan text check (earned_plan in ('plus1', 'plus2')),
  add column if not exists referral_daily_bonus smallint not null default 0;

comment on column public.profiles.referral_code is '초대 코드(8자 무작위) — 마이페이지 첫 접근 시 생성';
comment on column public.profiles.earned_plan is
  '초대·활동으로 달성한 등급 — 관리자 편집 대상인 scan_limit_override(jsonb)와 분리 보관. 유효 한도 = 필드별 max(배정, 달성)';
comment on column public.profiles.referral_daily_bonus is
  '초대받아 가입한 사용자의 일 검사 한도 보너스(현재 0|1) — 초대 건이 부정 기각되면 0으로 회수';
