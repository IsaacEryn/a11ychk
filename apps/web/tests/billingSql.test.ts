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
const SERVICE_ONLY = TABLES.filter((t) => t !== "subscriptions" && t !== "billing_payments");

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

  it("anon·authenticated의 쓰기 권한을 모든 결제 테이블에서 회수한다", () => {
    const m = sql.match(/revoke insert, update, delete on ([\s\S]+?) from anon, authenticated;/);
    expect(m).not.toBeNull();
    for (const t of TABLES) expect(m![1], t).toContain(`public.${t}`);
  });

  it("service role 전용 테이블은 조회 권한도 회수한다", () => {
    const m = sql.match(/revoke select on ([\s\S]+?) from anon, authenticated;/);
    expect(m).not.toBeNull();
    for (const t of SERVICE_ONLY) expect(m![1], t).toContain(`public.${t}`);
    expect(m![1]).not.toContain("public.subscriptions");
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
});
