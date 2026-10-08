import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations/0041_billing.sql"),
  "utf8",
);

const TABLES = [
  "billing_prices",
  "billing_customers",
  "billing_checkouts",
  "subscriptions",
  "billing_contracts",
  "billing_payments",
  "billing_refunds",
  "billing_consents",
  "billing_webhook_events",
];

describe("0041 결제 스키마", () => {
  it("모든 결제 테이블에 RLS를 켠다", () => {
    for (const t of TABLES) expect(sql, t).toContain(`alter table public.${t} enable row level security;`);
  });

  it("정책은 구독·결제의 본인 조회 두 개뿐이다", () => {
    const policies = [...sql.matchAll(/create policy (\w+)\s+on public\.(\w+)\s+for (\w+)/g)].map((m) => [m[2], m[3]]);
    expect(policies).toEqual([
      ["subscriptions", "select"],
      ["billing_payments", "select"],
    ]);
  });

  it("anon·authenticated 권한을 전부 회수하고 구독·결제 조회만 로그인 사용자에게 준다", () => {
    const revoke = sql.match(/revoke all on\s+([\s\S]+?)\s+from anon, authenticated;/);
    expect(revoke).not.toBeNull();
    for (const t of TABLES) expect(revoke![1], t).toContain(`public.${t}`);
    const grants = [...sql.matchAll(/grant (\w+(?:, \w+)*) on\s+([\s\S]+?)\s+to (\w+);/g)].map((m) => [m[1], m[3], m[2].replace(/\s+/g, " ")]);
    const toUsers = grants.filter(([, role]) => role === "authenticated" || role === "anon");
    expect(toUsers).toEqual([["select", "authenticated", "public.subscriptions, public.billing_payments"]]);
    const toService = grants.find(([, role]) => role === "service_role");
    expect(toService?.[0]).toBe("all");
    for (const t of TABLES) expect(toService?.[2], t).toContain(`public.${t}`);
  });

  it("가격 행을 넣지 않는다", () => {
    expect(sql).not.toMatch(/insert into public\.billing_prices/);
  });

  it("결제·계약 기록은 탈퇴 후에도 남는다", () => {
    const subs = sql.match(/create table if not exists public\.subscriptions \(([\s\S]+?)\n\);/);
    expect(subs?.[1]).toMatch(/user_id uuid references public\.profiles \(id\) on delete set null/);
    const pays = sql.match(/create table if not exists public\.billing_payments \(([\s\S]+?)\n\);/);
    expect(pays?.[1]).toMatch(/user_id uuid references public\.profiles \(id\) on delete set null/);
  });

  it("사용자·livemode당 진행 중 구독은 하나", () => {
    expect(sql).toMatch(
      /create unique index if not exists subscriptions_one_live_per_user\s+on public\.subscriptions \(user_id, livemode\) where status in \('active', 'past_due'\);/,
    );
  });

  it("공개 범위 플래그는 꺼진 채로 시작한다", () => {
    expect(sql).toMatch(/\('billing', '\{"showPrices": false, "checkoutOpen": false\}'::jsonb\)/);
  });

  it("정책은 다시 실행해도 깨지지 않게 먼저 지운다", () => {
    expect(sql).toContain("drop policy if exists subscriptions_select_own on public.subscriptions;");
    expect(sql).toContain("drop policy if exists billing_payments_select_own on public.billing_payments;");
  });

  it("갱신·재시도 결제는 구독과 기간이 있어야 한다", () => {
    expect(sql).toMatch(/check \(kind not in \('renewal', 'retry'\) or \(subscription_id is not null and period_start is not null\)\)/);
  });

  it("같은 조건의 활성 가격은 하나", () => {
    expect(sql).toMatch(/create unique index if not exists billing_prices_one_active\s+on public\.billing_prices \(plan_code, provider, currency, interval, livemode\) where active;/);
  });

  it("결제 시도는 구독을 참조한다(구독이 먼저 만들어진다)", () => {
    expect(sql.indexOf("create table if not exists public.subscriptions")).toBeLessThan(sql.indexOf("create table if not exists public.billing_checkouts"));
    expect(sql).toMatch(/subscription_id uuid references public\.subscriptions \(id\) on delete set null/);
  });

  it("빌링키 열은 암호문 형식만 받는다", () => {
    expect(sql).toMatch(/toss_billing_key_enc text check \(toss_billing_key_enc is null or toss_billing_key_enc like 'v1:%'\)/);
  });

  it("결제 시도는 새 구독과 카드 교체를 구분한다", () => {
    expect(sql).toMatch(/purpose text not null default 'subscribe' check \(purpose in \('subscribe', 'card_change'\)\)/);
  });
});
