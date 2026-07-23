"use client";

/**
 * 서비스 장애 신호 — 앱 어디서든 API 호출이 5xx/네트워크 실패로 무너지면 이 함수를 불러
 * 전역 배너(ServiceStatusBanner)에 알린다. 배너는 이후 헬스 체크로 자동 복구를 확인한다.
 *
 * 정상 상태에서는 아무 폴링도 하지 않는다(부하 0) — 실제 실패가 났을 때만 신호가 흐른다.
 */
export const SERVICE_DEGRADED_EVENT = "a11ychk:service-degraded";

export function notifyServiceDegraded(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SERVICE_DEGRADED_EVENT));
}

/**
 * fetch 응답이 서버 장애(5xx)인지 판정 — 배너 신호 발생 여부 결정용.
 * 4xx(입력 오류·권한 등)는 "서비스 장애"가 아니므로 배너를 띄우지 않는다.
 */
export function isServerOutage(status: number): boolean {
  return status >= 500;
}

/**
 * 앱 공용 fetch — 5xx·네트워크 실패 시 전역 장애 배너 신호를 자동 발사한다.
 * 4xx는 호출부의 로컬 피드백 책임 그대로. 네트워크 예외는 신호 후 다시 던져
 * 호출부의 기존 catch(로컬 오류 표시)가 그대로 동작한다.
 * 클라이언트 컴포넌트에서 /api/* 호출은 fetch 대신 이 래퍼를 쓸 것.
 */
export async function appFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(input, init);
    if (isServerOutage(res.status)) notifyServiceDegraded();
    return res;
  } catch (e) {
    notifyServiceDegraded();
    throw e;
  }
}
