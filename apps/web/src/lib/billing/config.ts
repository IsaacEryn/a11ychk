import "server-only";

/**
 * 결제 모드 — 결제사 호출 전체를 여닫는 하드 게이트(환경변수라 바꾸려면 재배포).
 * - off: 결제 기능 없음(기본, 지금 프로덕션). 권한 계산은 실결제(livemode=true) 행만 본다.
 * - test: 결제사 테스트 키로 동작(로컬·프리뷰). 테스트 결제 행(livemode=false)도 권한에 반영한다.
 * - live: 실결제.
 * 토스 시크릿 키 접두(test_/live_)가 모드와 어긋나면 off로 떨어진다. 프로덕션에 테스트 키를
 * 넣어 "공짜 구독"이 생기거나, 로컬에 실키를 넣어 실제로 돈이 나가는 사고를 막는다.
 * 기관 수동 계약은 항상 livemode=true라 모드와 무관하게 권한에 반영된다.
 */
export type BillingMode = "off" | "test" | "live";

export function billingMode(env: Record<string, string | undefined> = process.env): BillingMode {
  const mode = env.BILLING_MODE?.trim();
  if (mode !== "test" && mode !== "live") return "off";
  const secret = env.TOSS_SECRET_KEY?.trim() ?? "";
  if (secret && !secret.startsWith(`${mode}_`)) return "off";
  return mode;
}

/** 이용 권한 계산에 반영할 구독 행의 livemode 값 */
export function entitlementLivemodes(mode: BillingMode = billingMode()): boolean[] {
  return mode === "test" ? [true, false] : [true];
}

/** 토스 키 — 모드가 켜져 있고 두 키가 모두 그 모드 접두일 때만. 없으면 결제사 호출 전에 멈춘다 */
export interface TossKeys {
  clientKey: string;
  secretKey: string;
}

export function tossKeys(env: Record<string, string | undefined> = process.env): TossKeys | null {
  const mode = billingMode(env);
  if (mode === "off") return null;
  const clientKey = env.TOSS_CLIENT_KEY?.trim() ?? "";
  const secretKey = env.TOSS_SECRET_KEY?.trim() ?? "";
  if (!clientKey.startsWith(`${mode}_`) || !secretKey.startsWith(`${mode}_`)) return null;
  return { clientKey, secretKey };
}

/** test 모드에서 결제할 수 있는 일반 계정(UUID, 쉼표 구분) — 관리자 계정은 보통 unlimited라 권한 변화가 가려진다 */
export function billingTestUserIds(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set((env.BILLING_TEST_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

/** 새로 만드는 결제 행의 livemode — off면 만들지 않는다 */
export function rowLivemode(mode: BillingMode = billingMode()): boolean | null {
  return mode === "off" ? null : mode === "live";
}
