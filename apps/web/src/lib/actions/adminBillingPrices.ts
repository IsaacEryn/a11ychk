"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction, logAppError } from "@/lib/logs";
import { isMissingTable } from "@/lib/billing/dbErrors";
import { parsePriceCreate, parsePriceId } from "@/lib/billing/price";
import { requireAdmin, type SaveState } from "./shared";

/**
 * 판매 가격표 — billing_prices 행은 불변이다. 금액을 바꾸려면 새 행을 만들고 이전 행을 비활성화한다
 * (행을 지우거나 고치지 않는다: 구독·결제 시도가 가격 행을 참조한다).
 * 같은 플랜·주기·모드의 활성 가격은 하나뿐이다(0041의 유니크 인덱스). provider는 toss, currency는 KRW로 고정.
 */

const PATH = "adminBillingPrices";

/** 가격 추가 — 같은 플랜·주기·모드에 활성 가격이 이미 있으면 activeExists */
export async function createPrice(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const { user: actor } = await requireAdmin();
  const parsed = parsePriceCreate(fd);
  if (!parsed.ok) return { error: parsed.error };
  const p = parsed.value;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("billing_prices")
    .insert({
      plan_code: p.planCode,
      provider: "toss",
      currency: "KRW",
      interval: p.interval,
      amount: p.amount,
      livemode: p.livemode,
      active: p.active,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (isMissingTable(error)) return { error: "migrationMissing" };
    if (error?.code === "23505") return { error: "activeExists" };
    await logAppError(admin, `createPrice failed: ${error?.message ?? "no row"}`, { path: PATH });
    return { error: "failed" };
  }

  await logAdminAction(admin, actor.id, "billing.price_create", undefined, {
    priceId: data.id,
    plan: p.planCode,
    interval: p.interval,
    amount: p.amount,
    livemode: p.livemode,
    // 감사 화면은 detail.active를 "시행 시작·중지"(요금제 시행 전환)로 읽으므로 가격의 활성 여부는 다른 키로 남긴다
    priceActive: p.active,
  });
  return { ok: true };
}

/** 가격 비활성화 — active=false로만 바꾼다. 이미 비활성이거나 없는 행은 notFound */
export async function deactivatePrice(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const { user: actor } = await requireAdmin();
  const parsed = parsePriceId(fd);
  if (!parsed.ok) return { error: parsed.error };
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("billing_prices")
    .update({ active: false })
    .eq("id", parsed.value.priceId)
    .eq("active", true) // 조회 없이 한 번에 — 다른 관리자가 먼저 껐다면 바꾼 행이 없다
    .select("id, plan_code, interval, amount, livemode");
  if (error) {
    if (isMissingTable(error)) return { error: "migrationMissing" };
    await logAppError(admin, `deactivatePrice failed: ${error.message}`, { path: PATH });
    return { error: "failed" };
  }
  const row = data?.[0];
  if (!row) return { error: "notFound" };

  await logAdminAction(admin, actor.id, "billing.price_deactivate", undefined, {
    priceId: row.id,
    plan: row.plan_code,
    interval: row.interval,
    amount: row.amount,
    livemode: row.livemode,
    priceActive: false,
  });
  return { ok: true };
}
