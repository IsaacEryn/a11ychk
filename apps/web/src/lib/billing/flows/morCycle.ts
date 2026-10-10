import "server-only";
import { iso } from "@/lib/billing/period";
import { PolarError } from "@/lib/billing/polar";
import { canonicalTime, morAutoRefundId, syncMorSubscription, type MorSyncResult } from "@/lib/billing/flows/mor";
import type { MorDeps, MorSubscriptionRow, RefundRow } from "@/lib/billing/types";

/**
 * 결제 크론의 판매 대행(Polar) 단계 — 기존 구독 행이 웹훅을 놓쳐 정본과 어긋난 것을 다시 읽어 맞춘다. 행이 없는 새 구독·주문·환불은
 * 메우지 못한다(상한으로 처리됨이 된 웹훅은 운영자가 processed_at을 비우고 다시 보낸다 — flows/morWebhook.ts).
 * 결제를 일으키지 않는다(갱신 청구는 Polar가 한다). 한 번 실행하면 이 순서로 처리한다.
 *
 * 1) 만료 시각이 지난 open MoR 결제 시도를 expired로 닫는다(실패 코드는 그대로 — 결제 시작의 만료 판정과 같다).
 * 2) 자동 환불 선점 뒤 함수가 멈춰(시간 초과·강제 종료) Polar 환불 id 없이 30분 넘게 pending으로 남은 자동 환불 기록마다
 *    needs review 한 줄(id만). 하루 한 번 도는 크론이라 한 기록이 하루에 한 번 알린다. Polar를 부르지 않는다(환불 한 건 조회가 없다).
 * 3) 진행 중 MoR 구독 중 기간 끝이 6시간 넘게 지났거나(갱신 웹훅을 놓쳤을 수 있다) 미납인 것(Polar가 재시도 끝에 해지했을 수 있다)을
 *    오래된 순서로 50건까지 — Polar에서 다시 읽어 syncMorSubscription(웹훅과 같은 동기화)에 넘긴다.
 *    - Polar에 없으면(404) 행을 ended(admin)로 끝내고 needs review 한 줄. 다만 그 실행에서 읽힌 구독이 하나라도 있을 때만, 또는
 *      후보가 하나뿐이고 미루지 않았을 때만 끝낸다 — 다른 조직(또는 다른 sandbox)의 토큰이면 모든 구독이 404라 구독자를 한꺼번에
 *      끝내게 된다. 끝낼 때는 읽은 상태·external_updated_at을 조건으로 써서 그 사이 반영된 웹훅을 덮지 않는다. 사유 admin은
 *      일시정지 표지를 겸해, 나중에 같은 구독이 Polar에서 다시 읽히면 동기화가 되살린다.
 *    - 401·403(토큰·권한)은 다른 구독도 같은 이유로 실패하니 그 실행의 대사를 멈춘다(기록 한 줄).
 *    - 결과 불명·저장소 오류는 그 건만 실패로 세고 다음 건을 계속한다(다음 날 다시 본다).
 * 예산(deadline)을 넘기면 남은 구독은 다음 날로 미룬다. 던지지 않는다 — 실패는 개수와 기록으로 남긴다.
 *
 * 요약 키: mor_candidates·mor_synced·mor_refunded(기간을 줄 수 없어 해지·환불)·mor_review·mor_failed·mor_ended(404로 끝냄)·
 * mor_changed(끝내려는 사이 행이 바뀜)·mor_deferred·mor_expired(닫은 시도)·mor_stale_refunds·mor_halted. 관리자 도구는
 * 실패·확인 필요·중단을 문제로 보인다(cycleSummary.ts).
 */

/** 기간 끝에서 이만큼 지나도 갱신이 반영되지 않았으면 다시 읽는다 — Polar의 갱신 청구·웹훅 재시도가 끝날 여유 */
export const MOR_RECONCILE_LAG_MS = 6 * 3_600_000;
export const MOR_RECONCILE_LIMIT = 50;
/** 자동 환불 기록이 Polar 환불 id 없이 이만큼 pending이면 알린다 — 함수 최대 실행 시간보다 충분히 길게 */
export const STALE_REFUND_AFTER_MS = 30 * 60_000;
const STALE_REFUND_LIMIT = 50;
/** 결제 크론과 같은 기본 예산(따로 돌릴 때) */
const DEFAULT_BUDGET_MS = 240_000;
/** 계정 단위 Polar 오류 — 토큰·권한 문제라 다른 구독도 같은 이유로 실패한다 */
const HALT_STATUSES = new Set([401, 403]);
/** 저장된 Polar 시각이 비어 있던 행의 조건 시각 — "아직 비어 있을 때만" */
const EPOCH = "1970-01-01T00:00:00.000000Z";

const errorText = (e: unknown) => (e instanceof PolarError ? `${e.code} (${e.status})` : e instanceof Error ? e.message : String(e)).slice(0, 300);

/** 자동 환불 기록 — 결제 id에서 정한 결정적 id, 또는 자동 환불의 사유(auto_*) */
const isAutoRefund = (r: RefundRow) => r.id === morAutoRefundId(r.payment_id) || r.reason.startsWith("auto_");

/** 동기화 결과 → 요약 키 — 해지·환불을 확정하지 못했으면(refund review) 확인 필요로 센다 */
function resultKey(result: MorSyncResult): "mor_synced" | "mor_refunded" | "mor_review" {
  if (result.kind === "review") return "mor_review";
  if (result.kind === "ungranted") return result.refund === "review" ? "mor_review" : "mor_refunded";
  return "mor_synced";
}

export async function runMorCycle(deps: MorDeps, livemode: boolean, opts: { deadline?: number } = {}): Promise<Record<string, number>> {
  const deadline = opts.deadline ?? deps.now() + DEFAULT_BUDGET_MS;
  const summary: Record<string, number> = {
    mor_candidates: 0,
    mor_synced: 0,
    mor_review: 0,
    mor_failed: 0,
    mor_deferred: 0,
    mor_expired: 0,
    mor_stale_refunds: 0,
  };
  const bump = (key: string, by = 1) => {
    summary[key] = (summary[key] ?? 0) + by;
  };

  // 1) 만료된 결제 시도
  try {
    summary.mor_expired = await deps.store.expireOpenCheckouts("mor", livemode, iso(deps.now()));
  } catch (e) {
    bump("mor_failed");
    await deps.log(`billing mor reconcile could not expire checkout attempts: ${errorText(e)}`);
  }

  // 2) Polar 환불 id 없이 남은 자동 환불
  try {
    const stale = await deps.store.listStaleRefunds("mor", livemode, iso(deps.now() - STALE_REFUND_AFTER_MS), STALE_REFUND_LIMIT);
    for (const r of stale.filter(isAutoRefund)) {
      bump("mor_stale_refunds");
      await deps.log(`billing needs review: automatic refund ${r.id} for payment ${r.payment_id} has been pending without a Polar id`);
    }
  } catch (e) {
    bump("mor_failed");
    await deps.log(`billing mor reconcile could not check pending refunds: ${errorText(e)}`);
  }

  // 3) 구독 대사
  let candidates: MorSubscriptionRow[];
  try {
    candidates = await deps.store.listMorReconcileCandidates(livemode, iso(deps.now() - MOR_RECONCILE_LAG_MS), MOR_RECONCILE_LIMIT);
  } catch (e) {
    bump("mor_failed");
    await deps.log(`billing mor reconcile could not list subscriptions: ${errorText(e)}`);
    return summary;
  }
  summary.mor_candidates = candidates.length;

  const notFound: MorSubscriptionRow[] = [];
  let read = 0;
  let deferred = 0;
  for (let i = 0; i < candidates.length; i++) {
    if (deps.now() >= deadline) {
      deferred = candidates.length - i;
      bump("mor_deferred", deferred);
      break;
    }
    const row = candidates[i];
    const externalId = row.external_id;
    if (!externalId) continue; // 후보 조회가 거른다
    let sub;
    try {
      sub = await deps.polar.getSubscription(externalId);
      read++;
    } catch (e) {
      if (e instanceof PolarError && e.status === 404) {
        notFound.push(row);
        continue;
      }
      bump("mor_failed");
      if (e instanceof PolarError && HALT_STATUSES.has(e.status)) {
        summary.mor_halted = 1;
        deferred = candidates.length - i - 1;
        bump("mor_deferred", deferred);
        await deps.log(`billing mor reconcile halted: Polar refused the access token (${e.code} ${e.status})`);
        break;
      }
      await deps.log(`billing mor reconcile failed for subscription ${row.id}: ${errorText(e)}`);
      continue;
    }
    try {
      bump(resultKey(await syncMorSubscription(deps, sub, livemode)));
    } catch (e) {
      bump("mor_failed");
      await deps.log(`billing mor reconcile failed for subscription ${row.id}: ${errorText(e)}`);
    }
  }

  if (notFound.length === 0) return summary;
  // 읽힌 구독이 있어야 토큰이 이 조직의 것임을 안다 — 후보가 하나뿐이고 미루지 않았으면 그 하나를 믿는다
  const trusted = read > 0 || (candidates.length === 1 && deferred === 0);
  if (!trusted) {
    bump("mor_review");
    await deps.log(
      `billing needs review: mor subscriptions ${notFound.map((r) => r.external_id).join(",")} (rows ${notFound.map((r) => r.id).join(",")}) were not found at Polar and no subscription could be read in this run; rows left as they are — check that the Polar access token belongs to the organization of this billing mode`,
    );
    return summary;
  }
  for (const row of notFound) {
    try {
      bump((await endNotFound(deps, row)) ? "mor_ended" : "mor_changed");
    } catch (e) {
      bump("mor_failed");
      await deps.log(`billing mor reconcile failed for subscription ${row.id}: ${errorText(e)}`);
    }
  }
  return summary;
}

/**
 * Polar에 없는 구독의 행을 ended(admin)로 — 읽은 상태와 읽은 external_updated_at 그대로일 때만(비어 있었으면 아직 비어 있을 때만).
 * 그 사이 웹훅이 더 새로운 Polar 시각으로 행을 적었으면 덮지 않는다(false). external_updated_at은 그대로 둔다(Polar 시각이 아니다).
 */
async function endNotFound(deps: MorDeps, row: MorSubscriptionRow): Promise<boolean> {
  const nowIso = iso(deps.now());
  const notAfter = canonicalTime(row.external_updated_at) ?? EPOCH;
  const written = await deps.store.updateMorSubscriptionIf(
    row.id,
    { status: row.status, notAfter },
    { status: "ended", ended_reason: "admin", ended_at: nowIso },
  );
  if (written !== "updated") return false;
  await deps.log(`billing needs review: mor subscription ${row.external_id} (row ${row.id}) was not found at Polar; row ended`);
  return true;
}
