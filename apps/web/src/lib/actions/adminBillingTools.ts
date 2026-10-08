"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction, logAppError } from "@/lib/logs";
import { billingMode, rowLivemode } from "@/lib/billing/config";
import { isMissingTable } from "@/lib/billing/dbErrors";
import { runBillingCycle } from "@/lib/billing/flows/renew";
import { errorText } from "@/lib/billing/flows/subscribe";
import { parsePullDue, planPullDue, type PullKind, type PullableSubscription } from "@/lib/billing/pullDue";
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
    // 중간까지 결제가 나갔을 수 있으니 실패도 감사에 남긴다. 오류 문구는 흐름이 쓰는 errorText(비밀 값 없음)로
    await logAppError(admin, `runBillingCycleNow failed: ${errorText(e)}`, { path: PATH });
    await logAdminAction(admin, actor.id, "billing.cycle_run", undefined, { mode, ok: false });
    return { error: "failed" };
  }

  await logAdminAction(admin, actor.id, "billing.cycle_run", undefined, { mode, ok: true, summary });
  return { ok: true, summary };
}

/** 결제일 당기기 결과 — 실제로 당긴 종류(charge·remind·retry)를 알려 성공 문구를 맞춘다 */
export interface PullState extends SaveState {
  kind?: PullKind;
}

/**
 * 테스트 구독의 결제일을 당긴다. 무엇을 바꾸는지는 lib/billing/pullDue.ts planPullDue가 정한다:
 * 진행 중이면 기간 끝(charge = 1분 뒤, remind = 2일 뒤 — 안내 기록도 비운다), 미납이면 다음 재시도 시점만.
 * livemode=false인 toss 구독의 진행 중(active·past_due) 행만 바꾼다 — 읽을 때와 쓸 때 모두 같은 조건을 건다.
 */
export async function pullDueDate(_prev: PullState, fd: FormData): Promise<PullState> {
  const { user: actor } = await requireAdmin();
  const parsed = parsePullDue(fd);
  if (!parsed.ok) return { error: parsed.error };
  const admin = createAdminClient();

  const { data: sub, error } = await admin
    .from("subscriptions")
    .select("id, user_id, provider, livemode, status, current_period_start, current_period_end, next_retry_at, grace_until")
    .eq("id", parsed.value.subscriptionId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { error: "migrationMissing" };
    await logAppError(admin, `pullDueDate lookup failed: ${error.message}`, { path: PATH });
    return { error: "failed" };
  }
  if (!sub) return { error: "notFound" };
  if (sub.provider !== "toss" || sub.livemode !== false) return { error: "notTest" };
  if (sub.status !== "active" && sub.status !== "past_due") return { error: "ended" };

  const plan = planPullDue(sub as PullableSubscription, parsed.value.target, Date.now());
  if (!plan.ok) return { error: plan.error };

  const { data: changed, error: updateError } = await admin
    .from("subscriptions")
    .update(plan.patch)
    .eq("id", sub.id)
    // 쓸 때도 같은 조건을 건다 — 읽은 뒤 끝났거나 다른 경로(크론·카드 변경)가 바꾼 행을 되살리거나 덮어쓰지 않게
    .eq("provider", "toss")
    .eq("livemode", false)
    .in("status", ["active", "past_due"])
    .eq("status", sub.status)
    .eq("current_period_end", sub.current_period_end)
    .select("id");
  if (updateError) {
    if (isMissingTable(updateError)) return { error: "migrationMissing" };
    await logAppError(admin, `pullDueDate failed: ${updateError.message}`, { path: PATH });
    return { error: "failed" };
  }
  if (!changed || changed.length === 0) return { error: "ended" };

  await logAdminAction(admin, actor.id, "billing.pull_due", (sub.user_id as string | null) ?? undefined, {
    subscriptionId: sub.id,
    status: sub.status,
    target: plan.kind,
    from: plan.from,
    to: plan.to,
  });
  return { ok: true, kind: plan.kind };
}
