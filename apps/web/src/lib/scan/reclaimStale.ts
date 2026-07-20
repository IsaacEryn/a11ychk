import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { drainQueue } from "./drain";

/**
 * 좀비 검사 판정 임계(분). 오케스트레이터(runScan)의 maxDuration이 300s이므로,
 * 그보다 오래 running/queued에 머문 검사는 함수 타임아웃·인스턴스 회수로 죽은 것으로
 * 간주한다(여유를 둬 10분). 정상 검사는 5분 안에 done/failed로 전이된다.
 */
export const STALE_SCAN_MINUTES = 10;

const STALE_ERROR =
  "검사가 제한 시간 내 완료되지 않아 자동 중단되었습니다. 페이지가 많은 사이트일 수 있어요. 다시 시도해 주세요.";

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
  const cutoff = new Date(Date.now() - STALE_SCAN_MINUTES * 60_000).toISOString();
  let q = admin
    .from("scans")
    .update({ status: "failed", error: STALE_ERROR, finished_at: new Date().toISOString() })
    .in("status", ["queued", "running"])
    .lt("created_at", cutoff);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  if (opts.scanId) q = q.eq("id", opts.scanId);
  const { data } = await q.select("id").then((r) => r, () => ({ data: null }));
  const reclaimed = data?.length ?? 0;

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
