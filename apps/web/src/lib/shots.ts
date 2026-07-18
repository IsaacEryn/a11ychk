import "server-only";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlan, type PlanId } from "@/lib/quota";

/**
 * 위반 요소 스크린샷 — 비용 가드레일 4계층.
 * L1 생성: 스캔당 최대 장수·critical/serious만·규칙당 1장·JPEG q60 클립 (runScan)
 * L2 보존: 플랜별 보존 기간 경과 시 삭제 (free 10일 / pro 90일 / enterprise 365일)
 * L3 전역 예산: 총 용량이 예산을 넘으면 오래된 스캔부터 삭제 — 사용자 수와 무관하게 상한 고정
 * L4 관측: 예산 80% 도달 시 관리자 이메일 (관리자 대시보드에도 사용량 표시)
 * migration 0015 미적용 환경에서는 모든 단계가 조용히 건너뛴다 (best-effort).
 */
export const SHOTS_BUCKET = "shots";
export const SHOT_MAX_PER_SCAN = 10;
export const SHOT_BUDGET_BYTES = 700 * 1024 * 1024; // 700MB (Supabase 무료 티어 1GB 내 안전 마진)
export const SHOT_RETENTION_DAYS: Record<PlanId, number> = { free: 10, pro: 90, enterprise: 365 };

export interface CapturedShot {
  ruleId: string;
  selector: string;
  bytes: Buffer;
}

/**
 * 페이지 캡처 결과를 업로드하고 대표 finding 행에 경로를 연결한다.
 * 실패해도 검사 결과에는 영향 없음.
 */
export async function uploadPageShots(
  db: SupabaseClient,
  scanId: string,
  pageRowId: string,
  shots: CapturedShot[],
): Promise<number> {
  let uploaded = 0;
  for (const shot of shots) {
    try {
      const path = `${scanId}/${crypto.randomBytes(16).toString("hex")}.jpg`;
      const { error: upErr } = await db.storage
        .from(SHOTS_BUCKET)
        .upload(path, shot.bytes, { contentType: "image/jpeg" });
      if (upErr) continue;
      // 같은 페이지·규칙·셀렉터의 대표 행 1건에만 연결
      const { data: row } = await db
        .from("findings")
        .select("id")
        .eq("scan_page_id", pageRowId)
        .eq("rule_id", shot.ruleId)
        .eq("selector", shot.selector)
        .limit(1)
        .maybeSingle();
      if (!row) {
        await db.storage.from(SHOTS_BUCKET).remove([path]);
        continue;
      }
      const { error: linkErr } = await db.from("findings").update({ screenshot_path: path }).eq("id", row.id);
      if (linkErr) {
        // 0015 미적용 (컬럼 없음) — 업로드 롤백
        await db.storage.from(SHOTS_BUCKET).remove([path]);
        continue;
      }
      uploaded += shot.bytes.length;
    } catch {
      // 개별 캡처 저장 실패 무시
    }
  }
  return uploaded;
}

/** 스캔의 캡처 전부 삭제 (storage 객체 + findings 연결 + 회계) */
async function purgeScanShots(db: SupabaseClient, scanId: string): Promise<void> {
  const { data: objects } = await db.storage.from(SHOTS_BUCKET).list(scanId, { limit: 100 });
  const paths = (objects ?? []).map((o) => `${scanId}/${o.name}`);
  if (paths.length > 0) await db.storage.from(SHOTS_BUCKET).remove(paths);

  const { data: pages } = await db.from("scan_pages").select("id").eq("scan_id", scanId);
  const pageIds = (pages ?? []).map((p) => p.id as string);
  if (pageIds.length > 0) {
    await db
      .from("findings")
      .update({ screenshot_path: null })
      .in("scan_page_id", pageIds)
      .not("screenshot_path", "is", null);
  }
  await db.from("scans").update({ shots_bytes: 0 }).eq("id", scanId);
}

/**
 * 크론용 정리 — L2 플랜별 보존 + L3 전역 예산 + L4 80% 알림.
 * 한 번의 실행에서 처리량을 제한해 함수 시간 한도를 보호한다.
 */
export async function cleanupShots(db: SupabaseClient): Promise<{ purged: number; totalBytes: number }> {
  let purged = 0;

  // 후보: 캡처가 있는 스캔 중 최소 보존 기간(free 10일)을 지난 것부터
  const minCutoff = new Date(Date.now() - SHOT_RETENTION_DAYS.free * 24 * 3600_000).toISOString();
  const { data: candidates, error } = await db
    .from("scans")
    .select("id, user_id, created_at, shots_bytes")
    .gt("shots_bytes", 0)
    .lt("created_at", minCutoff)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return { purged: 0, totalBytes: 0 }; // 0015 미적용

  // 소유자 플랜 일괄 조회
  const userIds = [...new Set((candidates ?? []).map((s) => s.user_id as string))];
  const planByUser = new Map<string, PlanId>();
  if (userIds.length > 0) {
    const { data: profiles } = await db.from("profiles").select("id, scan_limit_override").in("id", userIds);
    for (const p of profiles ?? []) planByUser.set(p.id as string, getPlan(p.scan_limit_override));
  }

  for (const scan of candidates ?? []) {
    const plan = planByUser.get(scan.user_id as string) ?? "free";
    const ageMs = Date.now() - new Date(scan.created_at as string).getTime();
    if (ageMs > SHOT_RETENTION_DAYS[plan] * 24 * 3600_000) {
      await purgeScanShots(db, scan.id as string);
      purged++;
    }
  }

  // 전역 예산 — 초과분은 오래된 스캔부터 (보존 기간과 무관하게 상한 고정)
  let totalBytes = 0;
  const { data: total } = await db.rpc("shots_total_bytes");
  totalBytes = Number(total) || 0;
  if (totalBytes > SHOT_BUDGET_BYTES) {
    const { data: oldest } = await db
      .from("scans")
      .select("id, shots_bytes")
      .gt("shots_bytes", 0)
      .order("created_at", { ascending: true })
      .limit(50);
    for (const scan of oldest ?? []) {
      if (totalBytes <= SHOT_BUDGET_BYTES) break;
      await purgeScanShots(db, scan.id as string);
      totalBytes -= Number(scan.shots_bytes) || 0;
      purged++;
    }
  }

  // 고아 정리 — 탈퇴 등으로 scans 행이 cascade 삭제되면 회계 기반 정리가 놓친다.
  // 버킷 최상위 폴더(scanId)를 순회해 대응 행이 없는 prefix를 삭제 (배치 상한).
  try {
    const { data: folders } = await db.storage.from(SHOTS_BUCKET).list("", { limit: 50 });
    for (const f of folders ?? []) {
      if (!/^[0-9a-f-]{36}$/.test(f.name)) continue;
      const { data: row } = await db.from("scans").select("id").eq("id", f.name).maybeSingle();
      if (!row) {
        await purgeScanShots(db, f.name);
        purged++;
      }
    }
  } catch {
    // 고아 정리 실패는 무시 (다음 크론에서 재시도)
  }

  // 80% 도달 알림 (일 1회 크론이라 하루 한 통)
  if (totalBytes > SHOT_BUDGET_BYTES * 0.8) {
    await alertBudget(totalBytes).catch(() => undefined);
  }

  return { purged, totalBytes };
}

async function alertBudget(totalBytes: number): Promise<void> {
  const to = process.env.ADMIN_ALERT_EMAIL;
  const key = process.env.RESEND_API_KEY;
  if (!to || !key) return;
  const mb = (n: number) => Math.round(n / 1024 / 1024);
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: "A11Y Check <noreply@a11ychk.com>",
      to,
      subject: `[A11Y Check] 스크린샷 저장 용량 주의 (${mb(totalBytes)}MB / ${mb(SHOT_BUDGET_BYTES)}MB)`,
      html: `<div style="font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:14px;line-height:1.6"><p>위반 요소 스크린샷 저장 용량이 전역 예산의 80%를 넘었습니다.</p><p><b>${mb(totalBytes)}MB / ${mb(SHOT_BUDGET_BYTES)}MB</b></p><p>예산 초과 시 오래된 스캔의 이미지부터 자동 삭제됩니다. 이 알림은 정리 크론에서 하루 한 번 발송됩니다.</p></div>`,
    }),
  });
}
