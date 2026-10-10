import { NextResponse } from "next/server";
import { billingMode, polarKeys, rowLivemode } from "@/lib/billing/config";
import { handleMorWebhook, parsePolarWebhookBody } from "@/lib/billing/flows/morWebhook";
import { shouldLog } from "@/lib/billing/logThrottle";
import { createMorDeps } from "@/lib/billing/server";
import type { MorDeps } from "@/lib/billing/types";
import { logAppError } from "@/lib/logs";
import { createAdminClient } from "@/lib/supabase/admin";
import { standardWebhookKeys, verifyStandardWebhook } from "@/lib/webhookSignature";

// Polar는 10초 안의 응답을 기다린다(2초 안 권장) — 처리는 정본 조회 한두 번이라 짧다. 함수 제한은 넉넉히 두고, Polar 호출 하나는
// POLAR_TIMEOUT_MS로 줄인다(느린 호출이 쌓여 응답 제한을 넘기면 전달 실패가 이어지고, 연속 10번이면 Polar가 끝점을 끈다)
export const maxDuration = 30;
const POLAR_TIMEOUT_MS = 4000;
// 결제 모드(환경변수)로 404·405를 가른다 — 빌드 때의 값으로 굳지 않게
export const dynamic = "force-dynamic";

/** 웹훅 시각 허용(±초) — 서명이 맞아도 이보다 어긋나면 재전송 공격·시계 어긋남으로 본다 */
const TOLERANCE_SEC = 300;

const notFound = () => new NextResponse("Not Found", { status: 404 });

/**
 * 서명 확인 전의 기록 — 누구나 보낼 수 있는 요청이라 같은 문구는 이 인스턴스에서 1분에 한 번만(logThrottle).
 * 문구에는 결과 코드만 넣는다(본문·헤더 값 없음). 관리자 클라이언트를 만들 수 없으면 건너뛴다.
 */
async function logThrottled(message: string): Promise<void> {
  if (!shouldLog(message)) return;
  try {
    await logAppError(createAdminClient(), message, { path: "billing" });
  } catch {
    // 기록은 best-effort
  }
}

/**
 * Polar 웹훅 끝점 — Standard Webhooks 서명을 확인한 뒤 처리 흐름(flows/morWebhook.ts)에 넘긴다.
 * - 결제 모드 off → 404(결제 API 없음). 모드는 켜졌는데 Polar 키·서비스 클라이언트가 없음 → 503(설정 뒤 Polar 재시도가 처리한다).
 * - 본문은 받은 원문 그대로(request.text) 서명을 확인한다. 서명·헤더가 틀리거나 시각이 ±5분을 넘으면 401 — DB를 건드리지 않는다.
 * - 서명은 맞는데 JSON이 아니면 400. 처리했으면(재전송·할 일 없음 포함) 200, 처리 중 실패는 500(last_error를 먼저 적는다 — Polar가 다시
 *   보낸다). 반영은 마쳤는데 처리됨(processed_at)을 적지 못해도 500 — 흐름이 기록 한 줄을 남기고, 다시 받으면 멱등하게 다시 처리한다.
 * 처리는 응답 전에 끝낸다(after() 없음) — 실제로 처리를 마친 이벤트만 processed로 적는다.
 * livemode는 이 배포의 결제 모드가 정한다(본문에서 읽지 않는다). 응답 본문에는 오류 내용을 싣지 않는다.
 */
export async function POST(request: Request): Promise<Response> {
  const livemode = rowLivemode(billingMode());
  if (livemode === null) return notFound();

  const keys = polarKeys();
  let deps: MorDeps | null = null;
  try {
    deps = keys ? createMorDeps({ timeoutMs: POLAR_TIMEOUT_MS }) : null;
  } catch {
    deps = null;
  }
  if (!keys || !deps) {
    await logThrottled("billing polar webhook is not configured (Polar keys or service client missing)");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const body = await request.text();
  const eventId = request.headers.get("webhook-id");
  const verdict = verifyStandardWebhook({
    id: eventId,
    timestamp: request.headers.get("webhook-timestamp"),
    signatureHeader: request.headers.get("webhook-signature"),
    body,
    keys: standardWebhookKeys(keys.webhookSecret),
    toleranceSec: TOLERANCE_SEC,
  });
  if (verdict !== "ok" || !eventId) {
    await logThrottled(`billing polar webhook rejected: ${verdict}`);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = parsePolarWebhookBody(body);
  if (!parsed) {
    await deps.log(`billing polar webhook ${eventId} has a malformed body`);
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    await handleMorWebhook(deps, { id: eventId, type: parsed.type, dataId: parsed.dataId, livemode });
  } catch {
    // 흐름이 기록 한 줄을 남겼다(처리 실패면 last_error도) — Polar가 다시 보낸다
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** POST가 아닌 메서드 — 결제가 꺼져 있으면 POST와 같이 404(끝점이 없다), 켜져 있으면 405 */
function otherMethod(): Response {
  if (rowLivemode(billingMode()) === null) return notFound();
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

export async function GET() {
  return otherMethod();
}
export async function PUT() {
  return otherMethod();
}
export async function PATCH() {
  return otherMethod();
}
export async function DELETE() {
  return otherMethod();
}
export async function OPTIONS() {
  return otherMethod();
}
