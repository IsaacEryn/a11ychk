import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { drainQueue } from "./drain";

/**
 * 좀비 검사 판정 임계(분) — 상태별 분리.
 *
 * - running: 실행 시작(started_at) 후 10분. maxDuration 300s + 여유 — 이보다 오래 running이면
 *   함수 타임아웃·인스턴스 회수로 죽은 것.
 * - queued: 생성(created_at) 후 30분. 전역 동시 상한(기본 3) 때문에 큐 대기 10분은 **정상**이라
 *   running과 같은 임계를 쓰면 부하 시 정상 대기 검사를 자가 파괴한다. 30분(약 25건 이상
 *   백로그)이 지나도 시작을 못 했다면 드레인 트리거가 유실된 비정상으로 보고 회수한다.
 */
export const STALE_RUNNING_MINUTES = 10;
export const STALE_QUEUED_MINUTES = 30;

const STALE_RUNNING_ERROR =
  "검사가 제한 시간 내 완료되지 않아 자동 중단되었습니다. 페이지가 많은 사이트일 수 있어요. 다시 시도해 주세요.";
const STALE_QUEUED_ERROR =
  "대기 시간이 너무 길어져 검사가 자동 취소되었습니다. 잠시 후 다시 시도해 주세요.";

/**
 * running/queued에 멈춘 좀비 검사를 failed로 회수한다.
 *
 * 함수가 강제 종료(maxDuration 초과·인스턴스 회수)되면 runScan의 try/finally 실패 기록이
 * 실행되지 못해 검사가 활성 상태로 남는다. 그러면 동시 실행 가드(createScan)와
 * 부분 유니크 인덱스(scans_one_active_per_user)가 **새 검사를 영구 차단**하고, UI에는
 * "검사 중"이 계속 표시된다. 이 함수를 검사 생성·상태 조회 시점에 호출해 자가 치유한다.
 *
 * @param opts.userId 지정 시 해당 사용자로 한정
 * @param opts.scanId 지정 시 해당 검사로 한정(진행 페이지 조회 시)
 * @returns 회수된 검사 수
 */
export async function reclaimStaleScans(
  admin: SupabaseClient,
  opts: { userId?: string; scanId?: string } = {},
): Promise<number> {
  const now = Date.now();
  const finishedAt = new Date(now).toISOString();

  // running 좀비 — 실행 시작 후 10분 초과 (started_at 없으면 created_at 폴백: 구형 행 방어)
  const runningCutoff = new Date(now - STALE_RUNNING_MINUTES * 60_000).toISOString();
  let qRunning = admin
    .from("scans")
    .update({ status: "failed", error: STALE_RUNNING_ERROR, finished_at: finishedAt })
    .eq("status", "running")
    .or(`started_at.lt.${runningCutoff},and(started_at.is.null,created_at.lt.${runningCutoff})`);
  if (opts.userId) qRunning = qRunning.eq("user_id", opts.userId);
  if (opts.scanId) qRunning = qRunning.eq("id", opts.scanId);
  const { data: deadRunning } = await qRunning.select("id").then((r) => r, () => ({ data: null }));

  // queued 좀비 — 생성 후 30분 초과(트리거 유실). 정상 큐 대기(≤30분)는 건드리지 않는다.
  const queuedCutoff = new Date(now - STALE_QUEUED_MINUTES * 60_000).toISOString();
  let qQueued = admin
    .from("scans")
    .update({ status: "failed", error: STALE_QUEUED_ERROR, finished_at: finishedAt })
    .eq("status", "queued")
    .lt("created_at", queuedCutoff);
  if (opts.userId) qQueued = qQueued.eq("user_id", opts.userId);
  if (opts.scanId) qQueued = qQueued.eq("id", opts.scanId);
  const { data: deadQueued } = await qQueued.select("id").then((r) => r, () => ({ data: null }));

  const reclaimed = (deadRunning?.length ?? 0) + (deadQueued?.length ?? 0);

  // 좀비 회수로 슬롯이 비었으면 드레인 킥 — 대기 중이던 queued가 자동 시작(트리거 유실 자가치유).
  // 상시 워커 없이 기존 트래픽(생성·상태조회)에 편승해 큐가 빠진다.
  if (reclaimed > 0) {
    kickDrain();
  }
  return reclaimed;
}

/** 응답 이후 드레인(request 컨텍스트면 after, 아니면 fire-and-forget). 실패해도 무시. */
function kickDrain(): void {
  try {
    after(() => drainQueue());
  } catch {
    // after()가 request 컨텍스트 밖(스크립트 등)이면 예외 — 즉시 fire-and-forget으로 폴백
    drainQueue().catch(() => undefined);
  }
}
