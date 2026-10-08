"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction, logAppError } from "@/lib/logs";
import { billingMode, rowLivemode } from "@/lib/billing/config";
import { parseSubscriptionId } from "@/lib/billing/contract";
import { isMissingTable } from "@/lib/billing/dbErrors";
import { runBillingCycle } from "@/lib/billing/flows/renew";
import { createBillingDeps } from "@/lib/billing/server";
import { requireAdmin, type SaveState } from "./shared";

/**
 * 결제 테스트 도구 — 결제 크론을 지금 돌리고, 테스트 구독의 결제일을 당긴다.
 * 결제일 당기기는 테스트 결제(livemode=false)의 카드 구독에만 쓸 수 있다. 실결제 구독의 기간을
 * 건드리면 사용자에게 예정에 없던 결제가 나가므로, 읽을 때와 쓸 때 모두 livemode=false를 요구한다.
 */

const PATH = "adminBillingTools";

/** 크론 실행 결과 — summary는 runBillingCycle이 돌려준 개수 그대로(키 이름은 renew.ts가 정한다) */
export interface CycleState extends SaveState {
  summary?: Record<string, number>;
}

/**
 * 결제 크론 지금 실행 — 결제 크론(/api/cron/billing)과 같은 함수·같은 모드를 쓴다.
 * 모드가 off면 아무것도 하지 않고(off), 키·암호화 키가 없으면 결제사 호출 전에 멈춘다(notConfigured).
 * live 모드는 기한이 된 실결제 구독에 실제 결제가 나가므로 확인 체크를 요구한다.
 */
export async function runBillingCycleNow(_prev: CycleState, fd: FormData): Promise<CycleState> {
  const { user: actor } = await requireAdmin();
  const mode = billingMode();
  const livemode = rowLivemode(mode);
  if (livemode === null) return { error: "off" };
  if (mode === "live" && fd.get("confirm") !== "on") return { error: "confirm" };
  const deps = createBillingDeps();
  if (!deps) return { error: "notConfigured" };

  const admin = createAdminClient();
  let summary: Record<string, number>;
  try {
    summary = await runBillingCycle(deps, livemode);
  } catch (e) {
    // 비밀 값은 오류 문구에 들어가지 않는다(흐름의 규칙) — 메시지만 남긴다
    await logAppError(admin, `runBillingCycleNow failed: ${e instanceof Error ? e.message : String(e)}`, { path: PATH });
    return { error: "failed" };
  }

  await logAdminAction(admin, actor.id, "billing.cycle_run", undefined, { mode, summary });
  return { ok: true, summary };
}

/** 결제일 당기기가 맞춰 둘 기준: 1분 뒤에 기한이 되도록 */
const DUE_IN_MS = 60_000;

/**
 * 테스트 구독의 결제일을 당긴다 — current_period_end를 지금 + 1분으로.
 * 0041의 check(current_period_end > current_period_start) 때문에 시작이 그보다 늦으면 지금 − 1분으로 맞추고,
 * 결제 예정 안내 메일을 다시 시험할 수 있게 reminder_sent_for를 비운다.
 * livemode=false인 toss 구독의 진행 중(active·past_due) 행만 바꾼다.
 */
export async function pullDueDate(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const { user: actor } = await requireAdmin();
  const parsed = parseSubscriptionId(fd);
  if (!parsed.ok) return { error: parsed.error };
  const admin = createAdminClient();

  const { data: sub, error } = await admin
    .from("subscriptions")
    .select("id, user_id, provider, livemode, status, current_period_start, current_period_end")
    .eq("id", parsed.value.subscriptionId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { error: "migrationMissing" };
    await logAppError(admin, `pullDueDate lookup failed: ${error.message}`, { path: PATH });
    return { error: "failed" };
  }
  if (!sub) return { error: "notFound" };
  if (sub.provider !== "toss" || sub.livemode !== false) return { error: "notTest" };
  if (sub.status === "ended") return { error: "ended" };

  const now = Date.now();
  const newEnd = new Date(now + DUE_IN_MS).toISOString();
  const patch: Record<string, unknown> = {
    current_period_end: newEnd,
    reminder_sent_for: null,
    updated_at: new Date(now).toISOString(),
  };
  if (Date.parse(sub.current_period_start as string) >= now + DUE_IN_MS) {
    patch.current_period_start = new Date(now - DUE_IN_MS).toISOString();
  }

  const { data: changed, error: updateError } = await admin
    .from("subscriptions")
    .update(patch)
    .eq("id", sub.id)
    // 쓸 때도 같은 조건을 건다 — 읽은 뒤 끝났거나 바뀐 행을 되살리거나 덮어쓰지 않게
    .eq("provider", "toss")
    .eq("livemode", false)
    .in("status", ["active", "past_due"])
    .select("id");
  if (updateError) {
    if (isMissingTable(updateError)) return { error: "migrationMissing" };
    await logAppError(admin, `pullDueDate failed: ${updateError.message}`, { path: PATH });
    return { error: "failed" };
  }
  if (!changed || changed.length === 0) return { error: "ended" };

  await logAdminAction(admin, actor.id, "billing.pull_due", (sub.user_id as string | null) ?? undefined, {
    subscriptionId: sub.id,
    from: sub.current_period_end,
    to: newEnd,
  });
  return { ok: true };
}
