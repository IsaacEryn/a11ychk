-- ═══════════════════════════════════════════════════════════════
-- a11ychk 초기 스키마
-- 실행: Supabase Dashboard → SQL Editor 또는 `supabase db push`
-- ═══════════════════════════════════════════════════════════════

-- ── profiles: auth.users 1:1 프로필 ──
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null default '사용자',
  role text not null default 'user' check (role in ('user', 'admin')),
  locale text not null default 'ko',
  -- 관리자가 사용자별 검사 한도를 조정할 때 사용 (null이면 기본값)
  -- 예: {"daily": 5, "weekly": 20, "monthly": 40}
  scan_limit_override jsonb,
  blocked boolean not null default false,
  created_at timestamptz not null default now()
);

-- 회원 가입 시 프로필 자동 생성
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, nickname)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'user_name',
      split_part(new.email, '@', 1),
      '사용자'
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 관리자 판별 (RLS 정책에서 사용, security definer로 재귀 방지)
create function public.is_admin()
returns boolean
language sql
security definer set search_path = ''
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- ── domains: 사용자가 등록한 검사 대상 도메인 ──
create table public.domains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  hostname text not null,
  verified boolean not null default false,
  verify_method text check (verify_method in ('dns_txt', 'meta_tag')),
  verify_token text not null default encode(gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now(),
  unique (user_id, hostname)
);

-- ── scans: 검사 실행 단위 ──
create table public.scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  domain_id uuid references public.domains (id) on delete set null,
  root_url text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),
  page_limit int not null default 5,
  -- @a11ychk/core ScanSummary jsonb
  summary jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index scans_user_created_idx on public.scans (user_id, created_at desc);
create index scans_status_idx on public.scans (status) where status in ('queued', 'running');

-- ── scan_pages: 페이지 단위 결과 ──
create table public.scan_pages (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans (id) on delete cascade,
  url text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed')),
  error text,
  -- 위반 노드 수 요약 {"critical": 2, "serious": 5, ...}
  violation_counts jsonb,
  -- 통과/확인필요 규칙 id 목록 (집계용)
  passes jsonb,
  incomplete jsonb,
  scanned_at timestamptz
);
create index scan_pages_scan_idx on public.scan_pages (scan_id);

-- ── findings: 규칙×노드 단위 위반 상세 ──
create table public.findings (
  id uuid primary key default gen_random_uuid(),
  scan_page_id uuid not null references public.scan_pages (id) on delete cascade,
  rule_id text not null,
  impact text not null check (impact in ('critical', 'serious', 'moderate', 'minor')),
  tags jsonb not null default '[]',
  help_url text,
  selector text not null,
  html_snippet text not null,
  failure_summary text not null default ''
);
create index findings_page_idx on public.findings (scan_page_id);
create index findings_rule_idx on public.findings (rule_id);

-- ── inquiries: 문의·기능 개선 요청 ──
create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null default 'question' check (type in ('bug', 'feature', 'question')),
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 5000),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  admin_reply text,
  created_at timestamptz not null default now(),
  replied_at timestamptz
);
create index inquiries_user_idx on public.inquiries (user_id, created_at desc);

-- ═══════════════════════ RLS 정책 ═══════════════════════
alter table public.profiles enable row level security;
alter table public.domains enable row level security;
alter table public.scans enable row level security;
alter table public.scan_pages enable row level security;
alter table public.findings enable row level security;
alter table public.inquiries enable row level security;

-- profiles: 본인 조회·수정(role/blocked 제외), 관리자 전체
create policy "profiles_select_own" on public.profiles
  for select using ((select auth.uid()) = id or public.is_admin());
create policy "profiles_update_own" on public.profiles
  for update using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
-- 권한 상승 방지: 클라이언트(authenticated)는 nickname·locale만 수정 가능.
-- role/blocked/scan_limit_override 변경은 서버(service role) 전용.
revoke update on public.profiles from authenticated;
grant update (nickname, locale) on public.profiles to authenticated;

-- domains
create policy "domains_select_own" on public.domains
  for select using ((select auth.uid()) = user_id or public.is_admin());
create policy "domains_insert_own" on public.domains
  for insert with check ((select auth.uid()) = user_id);
create policy "domains_delete_own" on public.domains
  for delete using ((select auth.uid()) = user_id);

-- scans: 조회만 클라이언트 허용 — 생성/갱신은 서버(service role)가 한도 검증 후 수행
create policy "scans_select_own" on public.scans
  for select using ((select auth.uid()) = user_id or public.is_admin());

-- scan_pages / findings: 소유 스캔을 통해 조회
create policy "scan_pages_select_own" on public.scan_pages
  for select using (
    exists (
      select 1 from public.scans s
      where s.id = scan_id and (s.user_id = (select auth.uid()) or public.is_admin())
    )
  );
create policy "findings_select_own" on public.findings
  for select using (
    exists (
      select 1 from public.scan_pages p
      join public.scans s on s.id = p.scan_id
      where p.id = scan_page_id and (s.user_id = (select auth.uid()) or public.is_admin())
    )
  );

-- inquiries
create policy "inquiries_select_own" on public.inquiries
  for select using ((select auth.uid()) = user_id or public.is_admin());
create policy "inquiries_insert_own" on public.inquiries
  for insert with check ((select auth.uid()) = user_id);
create policy "inquiries_admin_update" on public.inquiries
  for update using (public.is_admin());
