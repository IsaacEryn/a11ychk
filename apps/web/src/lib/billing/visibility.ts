import type { BillingMode } from "./config";

/**
 * 결제 공개 범위(순수 함수). 환경변수 모드가 하드 게이트, app_settings.billing 플래그가 공개 범위다.
 * test 모드는 관리자·테스터 전용이고 플래그로 열 수 없다 — 프로덕션에서 테스트 키로 일반 사용자가
 * 공짜 구독을 만드는 경로를 구조적으로 막는다. off에서 showPrices는 PG·MoR 심사용 진열이다.
 */
export interface BillingFlags {
  showPrices: boolean;
  checkoutOpen: boolean;
}

export interface Viewer {
  isAdmin: boolean;
  isTester: boolean;
}

export const ANONYMOUS_VIEWER: Viewer = { isAdmin: false, isTester: false };

export function priceLivemode(mode: BillingMode): boolean {
  return mode !== "test";
}

export function canSeePrices(mode: BillingMode, flags: BillingFlags, viewer: Viewer): boolean {
  if (mode === "test") return viewer.isAdmin || viewer.isTester;
  return flags.showPrices || (mode === "live" && viewer.isAdmin);
}

export function canCheckout(mode: BillingMode, flags: BillingFlags, viewer: Viewer): boolean {
  if (mode === "off") return false;
  if (mode === "test") return viewer.isAdmin || viewer.isTester;
  return flags.checkoutOpen || viewer.isAdmin;
}
