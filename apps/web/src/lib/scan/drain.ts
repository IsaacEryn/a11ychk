import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAppError } from "@/lib/logs";

/**
 * 전역 동시 실행 상한 — 동시에 running인 검사 수의 상한. 초과분은 queued로 대기한다.
 * A11YCHK_MAX_CONCURRENT_SCANS로 무재배포 조절(문제 시 1로 백오프). Hobby 2GB 기준 보수적 3.
 */
export const MAX_CONCURRENT_SCANS = Math.max(1, Number(process.env.A11YCHK_MAX_CONCURRENT_SCANS) || 3);

/** 내부 run-scan 엔드포인트 베이스 URL. 배포=VERCEL_URL 자동, 로컬/오버라이드=env. 없으면 null(인프로세스 폴백). */
function internalBaseUrl(): string | null {
  const explicit = process.env.A11YCHK_INTERNAL_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return null;
}

/**
 * 큐 드레인 — 남은 용량(MAX − running)만큼 오래된 queued 검사를 원자적으로 claim(running 전환)하고
 * 각각 실행한다. 실행은 내부 HTTP(run-scan 엔드포인트)로 분리 인보케이션에 태워 메모리 격리를 노리고,
 * 베이스 URL/시크릿이 없으면 인프로세스로 폴백한다.
 *
 * 트리거: 검사 생성 후, 각 검사 완료 후(run-scan 엔드포인트), 좀비 회수 후(reclaimStale), 일일 크론(백스톱).
 * 여러 곳에서 동시에 불려도 claim_scans의 advisory lock이 전역 running ≤ MAX를 보장한다.
 */
export async function drainQueue(): Promise<void> {
  const admin = createAdminClient();
  const ids = await claim(admin);
  if (ids.length === 0) return;

  const base = internalBaseUrl();
  const cron = process.env.CRON_SECRET;
  if (base && cron) {
    // 분리 인보케이션 — run-scan 엔드포인트가 202를 즉시 반환하고 자기 함수에서 실행하므로 빠르게 완료된다.
    await Promise.all(
      ids.map((id) =>
        fetch(`${base}/api/internal/run-scan`, {
          method: "POST",
          headers: { authorization: `Bearer ${cron}`, "content-type": "application/json" },
          body: JSON.stringify({ id }),
        }).then(
          () => undefined,
          () => undefined, // 실패해도 좀비 회수(10분)+재드레인으로 복구
        ),
      ),
    );
  } else {
    // 폴백(로컬 등 베이스 URL 미상): 이 인보케이션에서 병렬 실행 후 재드레인(다음 것).
    // runScan은 무거운 chromium 의존을 정적으로 끌어오므로 이 경로에서만 동적 import 한다
    // (프로덕션 HTTP 경로 및 drain을 import하는 페이지/reclaim 번들에서 스캐너 그래프 배제).
    const { runScan } = await import("./runScan");
    await Promise.all(ids.map((id) => runScan(id).catch(() => undefined)));
    await drainQueue();
  }
}

/**
 * 남은 용량만큼 queued를 running으로 claim — claim_scans RPC(0020, advisory lock) 단독 경로.
 * 예전의 JS 폴백(count→update)은 비원자라 동시 드레인 시 상한 초과(OOM 위험)가 가능해 제거했다.
 * 0020은 프로덕션 적용 확정 — RPC 오류는 claim 없이 로그만 남긴다(다음 트리거가 재시도).
 */
async function claim(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin.rpc("claim_scans", { p_cap: MAX_CONCURRENT_SCANS });
  if (error) {
    await logAppError(admin, `claim_scans rpc failed: ${error.message}`, { path: "drain.claim" });
    return [];
  }
  return ((data ?? []) as { id: string }[]).map((r) => r.id).filter(Boolean);
}
