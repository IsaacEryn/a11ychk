import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAppError } from "@/lib/logs";

/**
 * 크론 실행 기록 래퍼 — 시작/마감을 cron_runs(0030)에 남겨 "조용히 안 도는 크론"을
 * 관측 가능하게 한다. 기록은 best-effort: 0030 미적용·기록 실패여도 본문(fn)은 실행되고,
 * fn의 예외는 logAppError 후 그대로 다시 던져 라우트가 응답을 결정한다.
 */
export async function withCronRun(
  job: string,
  fn: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const { data: run } = await admin
    .from("cron_runs")
    .insert({ job })
    .select("id")
    .maybeSingle()
    .then(
      (r) => r,
      () => ({ data: null }),
    );

  const finish = async (ok: boolean, summary: Record<string, unknown>) => {
    if (!run) return;
    await admin
      .from("cron_runs")
      .update({ finished_at: new Date().toISOString(), ok, summary })
      .eq("id", run.id)
      .then(
        () => undefined,
        () => undefined,
      );
  };

  try {
    const summary = await fn();
    await finish(true, summary);
    return summary;
  } catch (e) {
    await finish(false, { error: String(e).slice(0, 500) });
    await logAppError(admin, `cron ${job} failed: ${String(e).slice(0, 500)}`, { path: `cron.${job}` });
    throw e;
  }
}

/**
 * 크론 무실행 판정 — 마지막 성공 시각이 임계 시간을 넘겼는지. (순수 함수 — 유닛 대상)
 * lastOkAt이 null(기록 자체가 없음)이면 판단 근거가 없으므로 stale로 보지 않는다 —
 * 0030 적용 직후 첫 실행에서 오경보를 내지 않기 위함.
 */
export function isCronStale(lastOkAt: string | null, thresholdHours: number, now = Date.now()): boolean {
  if (!lastOkAt) return false;
  const t = Date.parse(lastOkAt);
  if (Number.isNaN(t)) return false;
  return now - t > thresholdHours * 3600_000;
}

/** 상호 감시 임계 — 하루 1회 크론 기준, 지연 여유 2시간 */
export const CRON_STALE_HOURS = 26;

/** job의 마지막 성공 실행 시각 (없으면 null — 미적용 환경 포함) */
export async function lastCronOkAt(admin: SupabaseClient, job: string): Promise<string | null> {
  const { data } = await admin
    .from("cron_runs")
    .select("started_at")
    .eq("job", job)
    .eq("ok", true)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()
    .then(
      (r) => r,
      () => ({ data: null }),
    );
  return (data?.started_at as string | undefined) ?? null;
}
