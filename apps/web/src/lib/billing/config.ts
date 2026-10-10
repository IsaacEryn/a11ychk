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

/**
 * Polar(MoR) 키 — 모드가 켜져 있고 토큰(polar_…)과 웹훅 시크릿(whsec_… 또는 v1,whsec_…)이 모두 있을 때만.
 * Polar 토큰에는 test_/live_ 같은 접두가 없어 모드가 API를 고른다(test → sandbox, live → 운영).
 * sandbox 토큰은 운영 API에서, 운영 토큰은 sandbox에서 인증되지 않아 모드와 토큰이 어긋나면 돈이 움직이지 않고 401로 끝난다.
 */
export interface PolarKeys {
  accessToken: string;
  webhookSecret: string;
  /** 끝에 / 없음 */
  apiBase: string;
}

const POLAR_API_BASE = { test: "https://sandbox-api.polar.sh", live: "https://api.polar.sh" } as const;

export function polarKeys(env: Record<string, string | undefined> = process.env): PolarKeys | null {
  const mode = billingMode(env);
  if (mode === "off") return null;
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim() ?? "";
  const webhookSecret = env.POLAR_WEBHOOK_SECRET?.trim() ?? "";
  if (!/^polar_./.test(accessToken) || !/^(v1,)?whsec_./.test(webhookSecret)) return null;
  return { accessToken, webhookSecret, apiBase: POLAR_API_BASE[mode] };
}

/** test 모드에서 결제할 수 있는 일반 계정(UUID, 쉼표 구분) — 관리자 계정은 보통 unlimited라 권한 변화가 가려진다 */
export function billingTestUserIds(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set((env.BILLING_TEST_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

/** 새로 만드는 결제 행의 livemode — off면 만들지 않는다 */
export function rowLivemode(mode: BillingMode = billingMode()): boolean | null {
  return mode === "off" ? null : mode === "live";
}
