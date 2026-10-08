import { z } from "zod";
import { graceUntil } from "./period";

/**
 * 테스트 구독 결제일 당기기의 입력 검증과 변경 내용 계산(순수 함수). 서버 액션(lib/actions/adminBillingTools.ts)이
 * 이 결과만 믿고 DB에 쓴다. 판정은 결제 크론(flows/renew.ts decideRenewalAction)이 읽는 열에 맞춘다.
 *
 * - 진행 중(active): 기간 끝을 옮긴다. charge는 지금 + 1분(하루 전부터 결제하는 규칙 안), remind는 지금 + 2일
 *   (7일 전 안내 안·하루 전 결제 밖 — 월 구독은 7일, 연 구독은 30일 안내 구간에 모두 든다). 둘 다 안내 기록을 비운다.
 * - 미납(past_due): 기간 끝은 재시도의 기준(결제 기간 시작)이자 유예 기한의 기준이라 건드리지 않는다.
 *   다음 재시도 시점만 지금으로 당긴다. 유예 기한이 이미 지났으면 재시도가 아니라 종료 대상이다.
 */

export const PULL_TARGETS = ["charge", "remind"] as const;
export type PullTarget = (typeof PULL_TARGETS)[number];
/** 실제로 당긴 것 — 미납 구독은 재시도 시점이라 retry */
export type PullKind = PullTarget | "retry";

export const CHARGE_IN_MS = 60_000;
export const REMIND_IN_MS = 2 * 86_400_000;
/** 시작이 새 기간 끝보다 늦을 때 시작을 맞추는 간격 */
const START_BEFORE_MS = 60_000;

export type PullParse =
  | { ok: true; value: { subscriptionId: string; target: PullTarget } }
  | { ok: false; error: "invalid" };

/** target을 보내지 않거나 비우면 charge(미납 구독 폼은 target을 보내지 않는다) */
export function parsePullDue(fd: FormData): PullParse {
  const id = z.string().uuid().safeParse(String(fd.get("subscriptionId") ?? ""));
  const raw = fd.get("target");
  const target = raw === null || raw === "" ? "charge" : z.enum(PULL_TARGETS).safeParse(String(raw)).data;
  return id.success && target ? { ok: true, value: { subscriptionId: id.data, target } } : { ok: false, error: "invalid" };
}

export interface PullableSubscription {
  status: "active" | "past_due";
  current_period_start: string;
  current_period_end: string;
  next_retry_at: string | null;
  grace_until: string | null;
}

export type PullPlan =
  | {
      ok: true;
      kind: PullKind;
      /** subscriptions에 쓸 열 — 이 밖의 열은 건드리지 않는다 */
      patch: Record<string, string | null>;
      /** 감사용: 바뀌기 전·후 값(active는 기간 끝, past_due는 다음 재시도 시점) */
      from: string | null;
      to: string;
    }
  | { ok: false; error: "graceOver" };

export function planPullDue(sub: PullableSubscription, target: PullTarget, nowMs: number): PullPlan {
  const nowIso = new Date(nowMs).toISOString();

  if (sub.status === "past_due") {
    // 크론과 같은 기준: 저장된 유예 기한, 없으면 기간 끝에서 계산한 값
    const grace = Date.parse(sub.grace_until ?? graceUntil(sub.current_period_end));
    if (nowMs >= grace) return { ok: false, error: "graceOver" };
    return { ok: true, kind: "retry", patch: { next_retry_at: nowIso, updated_at: nowIso }, from: sub.next_retry_at, to: nowIso };
  }

  const end = nowMs + (target === "remind" ? REMIND_IN_MS : CHARGE_IN_MS);
  const endIso = new Date(end).toISOString();
  const patch: Record<string, string | null> = { current_period_end: endIso, reminder_sent_for: null, updated_at: nowIso };
  // 0041의 check(current_period_end > current_period_start)
  if (Date.parse(sub.current_period_start) >= end) patch.current_period_start = new Date(nowMs - START_BEFORE_MS).toISOString();
  return { ok: true, kind: target, patch, from: sub.current_period_end, to: endIso };
}
