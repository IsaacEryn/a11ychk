import { NextResponse, after } from "next/server";
import { z } from "zod";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { runScan } from "@/lib/scan/runScan";
import { drainQueue } from "@/lib/scan/drain";
import { sendAutoAlertIfNeeded } from "@/lib/scan/autoAlert";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const BodySchema = z.object({ id: z.string().uuid() });

/**
 * 내부 검사 실행 엔드포인트 — 큐 드레이너(drainQueue)가 claim한 검사를 이 함수의 자기
 * 인보케이션에서 실행한다(스캔당 독립 메모리 예산 → 패킹 OOM 완화). CRON_SECRET로 보호.
 * 202를 즉시 반환하고 백그라운드로 실행하며, 완료 후 재드레인해 다음 대기 검사를 시작한다.
 */
export async function POST(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const { id } = parsed.data;

  // 응답 후 백그라운드: 이 검사 실행 → 완료되면 슬롯이 비므로 재드레인(다음 queued 시작).
  // 자동(크론) 검사면 완료 직후 회귀 알림도 여기서 보낸다(크론은 큐 등록만 하므로).
  after(async () => {
    try {
      await runScan(id);
      await sendAutoAlertIfNeeded(createAdminClient(), id).catch(() => undefined);
    } finally {
      await drainQueue();
    }
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
