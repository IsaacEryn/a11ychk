"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction, logAppError } from "@/lib/logs";
import {
  parseContractCreate,
  parseContractEnd,
  parseContractUpdate,
  parseSubscriptionId,
} from "@/lib/billing/contract";
import { requireAdmin, type SaveState } from "./shared";

/**
 * 기관 수동 계약 — 견적·계좌이체·세금계산서는 화면 밖에서 처리하고, 관리자가 계약을
 * provider='manual' 구독(livemode=true)과 billing_contracts 상세로 등록한다.
 * 이용 권한은 기간 시각으로만 판정되므로(lib/entitlements.ts) 상태 정리가 늦어도 권한은 정확하다.
 * 카드·해외 결제 구독은 결제사 연동 뒤에 다룬다 — 여기서는 manual만 바꾼다.
 */

const PATH = "adminBilling";

/** 기관 계약 등록 */
export async function createContract(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const { user: actor } = await requireAdmin();
  const parsed = parseContractCreate(fd);
  if (!parsed.ok) return { error: parsed.error };
  const c = parsed.value;
  const admin = createAdminClient();

  // 기간이 끝난 이전 기관 계약은 먼저 종료 처리한다 — 진행 중 구독 1건 유니크 인덱스가
  // 갱신 계약 등록을 막지 않게(권한은 이미 시각으로 끊겨 있다)
  const nowIso = new Date().toISOString();
  const { error: expireError } = await admin
    .from("subscriptions")
    .update({ status: "ended", ended_reason: "contract_expired", ended_at: nowIso, updated_at: nowIso })
    .eq("user_id", c.userId)
    .eq("provider", "manual")
    .in("status", ["active", "past_due"])
    .lt("current_period_end", nowIso);
  if (expireError) {
    // 정리가 실패한 채 insert로 가면 관리자에게 "이미 진행 중 구독"이라는 엉뚱한 안내가 나간다
    await logAppError(admin, `createContract expire previous contracts failed: ${expireError.message}`, { path: PATH });
    return { error: "failed" };
  }

  const { data: sub, error } = await admin
    .from("subscriptions")
    .insert({
      user_id: c.userId,
      provider: "manual",
      livemode: true,
      plan_code: c.planCode,
      status: "active",
      amount: c.amount,
      currency: "KRW",
      interval: "contract",
      current_period_start: c.startAt,
      current_period_end: c.endAt,
    })
    .select("id")
    .single();
  if (error || !sub) {
    if (error?.code === "23505") return { error: "hasActive" };
    if (error?.code === "23503") return { error: "notFound" };
    await logAppError(admin, `createContract subscription insert failed: ${error?.message ?? "no row"}`, { path: PATH });
    return { error: "failed" };
  }

  const { error: detailError } = await admin.from("billing_contracts").insert({
    subscription_id: sub.id,
    org_name: c.orgName,
    contract_ref: c.contractRef,
    memo: c.memo,
    paid_confirmed_at: c.paidAt,
    tax_invoice_issued_at: c.taxInvoiceAt,
    created_by: actor.id,
  });
  if (detailError) {
    // 두 insert를 한 트랜잭션으로 묶을 수 없으므로 상세가 실패하면 구독 행을 되돌린다
    const { error: deleteError } = await admin.from("subscriptions").delete().eq("id", sub.id);
    await logAppError(admin, `createContract detail insert failed: ${detailError.message}`, { path: PATH });
    if (deleteError) {
      // 되돌리기까지 실패하면 상세·감사 기록이 없는 진행 중 구독이 권한을 계속 준다 — id를 남겨 수동 정리할 수 있게
      await logAppError(admin, `createContract rollback failed — orphan subscription ${sub.id}: ${deleteError.message}`, { path: PATH });
    }
    return { error: "failed" };
  }

  await logAdminAction(admin, actor.id, "billing.contract_create", c.userId, {
    subscriptionId: sub.id,
    plan: c.planCode,
    start: c.startAt,
    end: c.endAt,
  });
  return { ok: true };
}

/** 계약 상세(기관명·계약번호·메모·입금 확인일·세금계산서 발행일) 수정 */
export async function updateContract(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const { user: actor } = await requireAdmin();
  const parsed = parseContractUpdate(fd);
  if (!parsed.ok) return { error: parsed.error };
  const c = parsed.value;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_contracts")
    .update({
      org_name: c.orgName,
      contract_ref: c.contractRef,
      memo: c.memo,
      paid_confirmed_at: c.paidAt,
      tax_invoice_issued_at: c.taxInvoiceAt,
      updated_at: new Date().toISOString(),
    })
    .eq("subscription_id", c.subscriptionId)
    .select("subscription_id");
  if (error) {
    await logAppError(admin, `updateContract failed: ${error.message}`, { path: PATH });
    return { error: "failed" };
  }
  if (!data || data.length === 0) return { error: "notFound" };
  // 감사 화면은 대상을 사용자 id로 푼다 — 다른 세 액션과 맞추려고 구독의 소유자를 찾는다(조회 실패는 대상 없이 기록)
  const { data: owner } = await admin.from("subscriptions").select("user_id").eq("id", c.subscriptionId).maybeSingle();
  await logAdminAction(admin, actor.id, "billing.contract_update", (owner?.user_id as string | null) ?? undefined, {
    subscriptionId: c.subscriptionId,
    paid: c.paidAt !== null,
    taxInvoice: c.taxInvoiceAt !== null,
  });
  return { ok: true };
}

/** 진행 중인 기관 계약을 읽는다 — 없으면 오류 코드 */
async function loadManual(admin: ReturnType<typeof createAdminClient>, id: string) {
  const { data, error } = await admin
    .from("subscriptions")
    .select("id, user_id, provider, status, current_period_start, current_period_end")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    await logAppError(admin, `loadManual failed: ${error.message}`, { path: PATH });
    return { error: "failed" as const };
  }
  if (!data) return { error: "notFound" as const };
  if (data.provider !== "manual") return { error: "notManual" as const };
  if (data.status === "ended") return { error: "ended" as const };
  return { sub: data };
}

/** 계약 종료일 변경(연장·단축) */
export async function setContractEnd(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const { user: actor } = await requireAdmin();
  const parsed = parseContractEnd(fd);
  if (!parsed.ok) return { error: parsed.error };
  const admin = createAdminClient();
  const found = await loadManual(admin, parsed.value.subscriptionId);
  if ("error" in found) return { error: found.error };
  if (Date.parse(parsed.value.endAt) <= Date.parse(found.sub.current_period_start as string)) {
    return { error: "period" };
  }
  const { error } = await admin
    .from("subscriptions")
    .update({ current_period_end: parsed.value.endAt, updated_at: new Date().toISOString() })
    .eq("id", found.sub.id);
  if (error) {
    await logAppError(admin, `setContractEnd failed: ${error.message}`, { path: PATH });
    return { error: "failed" };
  }
  await logAdminAction(admin, actor.id, "billing.contract_extend", (found.sub.user_id as string | null) ?? undefined, {
    subscriptionId: found.sub.id,
    from: found.sub.current_period_end,
    to: parsed.value.endAt,
  });
  return { ok: true };
}

/** 기관 계약 즉시 종료 — 권한이 바로 끊긴다 */
export async function endContract(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const { user: actor } = await requireAdmin();
  if (fd.get("confirm") !== "on") return { error: "invalid" };
  const parsed = parseSubscriptionId(fd);
  if (!parsed.ok) return { error: parsed.error };
  const admin = createAdminClient();
  const found = await loadManual(admin, parsed.value.subscriptionId);
  if ("error" in found) return { error: found.error };
  const now = new Date().toISOString();
  const { error } = await admin
    .from("subscriptions")
    .update({ status: "ended", ended_reason: "admin", ended_at: now, updated_at: now })
    .eq("id", found.sub.id);
  if (error) {
    await logAppError(admin, `endContract failed: ${error.message}`, { path: PATH });
    return { error: "failed" };
  }
  await logAdminAction(admin, actor.id, "billing.contract_end", (found.sub.user_id as string | null) ?? undefined, {
    subscriptionId: found.sub.id,
  });
  return { ok: true };
}
