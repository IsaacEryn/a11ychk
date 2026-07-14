/**
 * 스캔 페이지 실패 원인을 사용자 친화적 카테고리로 분류한다.
 * 원본 에러(Playwright/브라우저 로그)는 기술적이고 위협적이므로, 사용자에게는
 * 이해하기 쉬운 설명과 대처 방법을 보여준다. (원본 에러는 관리자 로그에만 노출)
 */
export type ScanErrorReason =
  | "timeout"
  | "unreachable"
  | "blocked"
  | "temporary"
  | "engine"
  | "unknown";

export function classifyScanError(raw: string | null | undefined): ScanErrorReason {
  if (!raw) return "unknown";
  const e = raw.toLowerCase();

  if (e.includes("timeout") || e.includes("timed out")) return "timeout";
  if (
    e.includes("err_name_not_resolved") ||
    e.includes("err_connection") ||
    e.includes("err_cert") ||
    e.includes("net::err") ||
    e.includes("ns_error") ||
    e.includes("dns")
  )
    return "unreachable";
  if (
    e.includes("사설") ||
    e.includes("내부") ||
    e.includes("private") ||
    e.includes("robots") ||
    e.includes("허용하지 않")
  )
    return "blocked";
  // 브라우저가 도중에 종료됨 — 일시적 자원 문제(재시도로 대개 해결)
  if (e.includes("has been closed") || e.includes("crash") || e.includes("target closed")) return "temporary";
  if (e.includes("referenceerror") || e.includes("evaluate")) return "engine";
  return "unknown";
}
