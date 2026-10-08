import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { withCronRun } from "@/lib/cronRun";
import { billingMode, rowLivemode } from "@/lib/billing/config";
import { createBillingDeps } from "@/lib/billing/server";
import { runBillingCycle } from "@/lib/billing/flows/renew";

export const maxDuration = 300;

/**
 * 결제 크론 — 10:00 KST(카드사 응대 시간대, 사용자가 메일을 보고 바로 조치할 수 있다).
 * 모드가 off면 처리 없이 기록만 남긴다(상호 감시가 멈춤으로 오해하지 않게).
 * test 모드는 테스트 결제 행(livemode=false)만, live 모드는 실결제 행만 다룬다.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const summary = await withCronRun("billing", async () => {
    const livemode = rowLivemode(billingMode());
    if (livemode === null) return { skipped: "off" };
    const deps = createBillingDeps();
    if (!deps) return { skipped: "notConfigured" };
    return runBillingCycle(deps, livemode);
  });
  return NextResponse.json(summary);
}
