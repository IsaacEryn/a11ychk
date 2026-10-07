-- ═══════════════════════════════════════════════════════════════
-- 결제·구독 스키마
-- 실행: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════
-- 국내 카드 정기결제(toss), 해외 판매 대행(mor), 기관 수동 계약(manual)을 모두
-- subscriptions 한 테이블에 모은다. 이용 권한 계산(lib/entitlements.ts)이 유효한 행을
-- 근거로 삼는다 — 유효 여부는 status가 아니라 기간 시각으로 판정한다.
--
-- 가격 숫자는 여기에 넣지 않는다. billing_prices 행은 출시 직전에 관리자 화면에서 넣는다.
-- 접근: 사용자는 자기 subscriptions·billing_payments만 읽는다. 나머지 조회와 모든 쓰기는
-- service role 전용(referrals와 같은 방식).
-- 결제·계약·동의 기록은 회원 탈퇴 후에도 남긴다(on delete set null) — 전자상거래법상 5년 보존.
-- livemode: 로컬·프리뷰·프로덕션이 DB 하나를 같이 쓰므로 테스트 결제 행(false)을 구분한다.

create table if not exists public.billing_prices (
  id uuid primary key default gen_random_uuid(),
  plan_code text not null,
  provider text not null check (provider in ('toss', 'mor', 'manual')),
  currency text not null check (currency in ('KRW', 'USD')),
  interval text not null check (interval in ('month', 'year')),
  amount bigint not null check (amount > 0),
  external_price_id text,
  livemode boolean not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (provider, external_price_id)
);
comment on table public.billing_prices is
  '판매 가격표 — 행은 불변(금액을 바꾸면 새 행을 만들고 이전 행은 active=false). KRW는 원(VAT 포함), USD는 cent';

create table if not exists public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  livemode boolean not null,
  toss_customer_key text unique,
  toss_billing_key_enc text,
  toss_card_summary jsonb,
  mor_customer_id text,
  updated_at timestamptz not null default now(),
  unique (user_id, livemode)
);
comment on column public.billing_customers.toss_billing_key_enc is
  '토스 빌링키 암호문(AES-256-GCM, v1:iv:tag:ct). 결제 수단이라 탈퇴하면 행째 파기한다';

create table if not exists public.billing_checkouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('toss', 'mor')),
  livemode boolean not null,
  price_id uuid not null references public.billing_prices (id),
  status text not null default 'open'
    check (status in ('open', 'processing', 'completed', 'failed', 'expired')),
  failure_code text,
  subscription_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  provider text not null check (provider in ('toss', 'mor', 'manual')),
  mor_provider text check (mor_provider in ('paddle', 'polar')),
  livemode boolean not null,
  plan_code text not null,
  status text not null check (status in ('active', 'past_due', 'ended')),
  ended_reason text
    check (ended_reason in ('user_canceled', 'payment_failed', 'admin', 'refunded', 'contract_expired')),
  price_id uuid references public.billing_prices (id),
  amount bigint not null check (amount >= 0),
  currency text not null check (currency in ('KRW', 'USD')),
  interval text not null check (interval in ('month', 'year', 'contract')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  billing_anchor_day smallint check (billing_anchor_day between 1 and 31),
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_at timestamptz,
  dunning_attempts smallint not null default 0,
  next_retry_at timestamptz,
  grace_until timestamptz,
  reminder_sent_for timestamptz,
  external_id text,
  external_customer_id text,
  external_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end > current_period_start),
  unique (provider, external_id)
);
create unique index if not exists subscriptions_one_live_per_user
  on public.subscriptions (user_id, livemode) where status in ('active', 'past_due');
create index if not exists subscriptions_toss_due_idx
  on public.subscriptions (current_period_end) where provider = 'toss' and status in ('active', 'past_due');
comment on column public.subscriptions.amount is
  '구독 시점 가격 스냅샷 — 가격표가 바뀌어도 기존 구독은 이 금액으로 갱신한다(가격 인상은 별도 동의)';

create table if not exists public.billing_contracts (
  subscription_id uuid primary key references public.subscriptions (id) on delete cascade,
  org_name text not null,
  contract_ref text,
  memo text,
  paid_confirmed_at timestamptz,
  tax_invoice_issued_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.billing_contracts is '기관 수동 계약 상세 — 관리자 전용(사용자가 읽는 subscriptions와 분리)';

create table if not exists public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  checkout_id uuid references public.billing_checkouts (id) on delete set null,
  provider text not null check (provider in ('toss', 'mor', 'manual')),
  livemode boolean not null,
  kind text not null check (kind in ('initial', 'renewal', 'retry', 'manual')),
  order_id text not null unique,
  external_payment_id text,
  amount bigint not null check (amount >= 0),
  currency text not null check (currency in ('KRW', 'USD')),
  period_start timestamptz,
  period_end timestamptz,
  attempt smallint not null default 1,
  status text not null check (status in ('pending', 'paid', 'failed', 'refunded', 'partially_refunded')),
  failure_code text,
  failure_message text,
  receipt_url text,
  card_summary jsonb,
  refunded_amount bigint not null default 0 check (refunded_amount >= 0),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (provider, external_payment_id)
);
create unique index if not exists billing_payments_one_per_attempt
  on public.billing_payments (subscription_id, period_start, attempt) where kind in ('renewal', 'retry');

create table if not exists public.billing_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.billing_payments (id) on delete cascade,
  amount bigint not null check (amount > 0),
  reason text not null,
  external_refund_id text,
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  checkout_id uuid references public.billing_checkouts (id) on delete set null,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  kind text not null check (kind in ('recurring_payment', 'price_change', 'terms')),
  disclosure_version text not null,
  snapshot jsonb not null,
  accepted boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_webhook_events (
  provider text not null,
  event_id text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts smallint not null default 1,
  last_error text,
  payload jsonb,
  primary key (provider, event_id)
);

-- ── RLS ──
alter table public.billing_prices enable row level security;
alter table public.billing_customers enable row level security;
alter table public.billing_checkouts enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_contracts enable row level security;
alter table public.billing_payments enable row level security;
alter table public.billing_refunds enable row level security;
alter table public.billing_consents enable row level security;
alter table public.billing_webhook_events enable row level security;

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id or public.is_admin());

drop policy if exists billing_payments_select_own on public.billing_payments;
create policy billing_payments_select_own on public.billing_payments
  for select to authenticated using ((select auth.uid()) = user_id or public.is_admin());

-- Supabase 기본 권한이 새 테이블에 anon·authenticated grant를 붙이므로 명시적으로 회수한다
-- (0035와 같은 이유). 정책이 없어도 회수해 두면 콘솔에서 정책이 잘못 붙는 사고를 한 겹 더 막는다.
revoke insert, update, delete on public.billing_prices, public.billing_customers, public.billing_checkouts, public.subscriptions,
  public.billing_contracts, public.billing_payments, public.billing_refunds, public.billing_consents,
  public.billing_webhook_events
 from anon, authenticated;

revoke select on public.billing_prices, public.billing_customers, public.billing_checkouts, public.billing_contracts,
  public.billing_refunds, public.billing_consents, public.billing_webhook_events
 from anon, authenticated;

-- 공개 범위 플래그 — 가격 표시·결제 시작을 런타임에 연다(시크릿·가격은 넣지 않는다:
-- app_settings는 누구나 읽을 수 있다)
insert into public.app_settings (key, value)
values ('billing', '{"showPrices": false, "checkoutOpen": false}'::jsonb)
on conflict (key) do nothing;
