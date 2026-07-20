import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_CONCURRENT_SCANS } from "@/lib/scan/drain";
import { estimateWaitMinutes } from "@/lib/scan/queueEstimate";

/** 대기열 예상 시간 계산용 평균 검사 소요(분). 검사 예산(SCAN_BUDGET_MS≈3.5분) 기반 보수적 상수. */
const AVG_SCAN_MINUTES = 3;

/**
 * 대기열 현황 — queued 검사가 "앞에 N명 · 예상 ~M분"을 표시하기 위한 집계.
 * 소유권은 사용자 클라이언트(RLS)로 검증하고, 전역 카운트만 관리자 클라이언트로 조회한다
 * (RLS가 타 사용자 검사 카운트를 막으므로). 집계값만 노출(개별 검사 정보 아님).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 소유권 게이트 — RLS로 본인 검사만 조회 가능
  const { data: scan } = await supabase.from("scans").select("status, created_at").eq("id", id).maybeSingle();
  if (!scan) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (scan.status !== "queued") {
    return NextResponse.json({ status: scan.status });
  }

  // 전역 집계(관리자) — 이 검사보다 먼저 등록된 queued 수 + 현재 running 수
  const admin = createAdminClient();
  const [{ count: ahead }, { count: running }] = await Promise.all([
    admin
      .from("scans")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued")
      .lt("created_at", scan.created_at),
    admin.from("scans").select("id", { count: "exact", head: true }).eq("status", "running"),
  ]);

  const aheadCount = ahead ?? 0;
  const estMinutes = estimateWaitMinutes(aheadCount, MAX_CONCURRENT_SCANS, AVG_SCAN_MINUTES);

  return NextResponse.json({
    status: "queued",
    ahead: aheadCount,
    running: running ?? 0,
    max: MAX_CONCURRENT_SCANS,
    estMinutes,
  });
}
