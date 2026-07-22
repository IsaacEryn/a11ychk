import "server-only";
import { NextResponse } from "next/server";
import { negotiateLocale } from "@/lib/negotiateLocale";

/**
 * API 라우트 에러 응답 공용화 — { error(번역), code, params? } 계약.
 * - 브라우저 직접 GET(다운로드 라우트)은 클라이언트 번역이 불가하므로 서버가
 *   요청 로케일(?lang= 우선, Accept-Language 폴백)로 번역한 error를 내려준다.
 * - fetch 클라이언트는 code를 우선 번역(scanPage.apiErrors)하고 error는 폴백.
 * 사전은 messages json이 아닌 인라인 상수 — 라우트 핸들러 번들에 전체 메시지
 * 트리가 걸리지 않게 하고, next-intl 요청 컨텍스트 의존도 피한다.
 */
export type ApiLocale = "ko" | "en";

export type ApiErrorCode = keyof typeof MESSAGES;

const MESSAGES = {
  invalidRequest: { ko: "잘못된 요청입니다.", en: "Invalid request." },
  invalidBody: { ko: "잘못된 요청 형식입니다.", en: "Invalid request format." },
  invalidInput: { ko: "확인할 URL을 입력해 주세요.", en: "Please enter a URL to check." },
  loginRequired: { ko: "로그인이 필요합니다.", en: "Please sign in." },
  scanNotFound: { ko: "검사를 찾을 수 없습니다.", en: "Scan not found." },
  reportNotFound: { ko: "보고서를 찾을 수 없습니다.", en: "Report not found." },
  reportNotReady: { ko: "완료된 보고서를 찾을 수 없습니다.", en: "No completed report found." },
  pdfNotDone: {
    ko: "검사가 완료된 보고서만 PDF로 내려받을 수 있습니다.",
    en: "Only completed reports can be downloaded as PDF.",
  },
  pdfFailed: {
    ko: "PDF 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    en: "Failed to generate the PDF. Please try again shortly.",
  },
  rescanFailed: { ko: "페이지 재검사에 실패했습니다.", en: "Failed to re-scan the page." },
  rateLimited: {
    ko: "진단 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
    en: "Too many requests. Please try again later.",
  },
  checkFailed: {
    ko: "진단에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    en: "The check failed. Please try again shortly.",
  },
  usageFailed: {
    ko: "사용량 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    en: "Failed to process usage. Please try again shortly.",
  },
  saveFailed: { ko: "저장에 실패했습니다.", en: "Failed to save." },
  invalidScanData: { ko: "잘못된 검사 데이터입니다.", en: "Invalid scan data." },
  invalidTargetUrl: { ko: "검사 대상 URL이 올바르지 않습니다.", en: "Invalid target URL." },
  extQuotaExceeded: {
    ko: "오늘의 확장 검사 한도({limit}회)를 모두 사용했습니다.",
    en: "You've used all {limit} extension scans for today.",
  },
  extReportNotFound: { ko: "선택한 보고서를 찾을 수 없습니다.", en: "Selected report not found." },
} as const;

/** 요청 로케일 해석 — ?lang= 명시가 우선(기존 csv/pdf/ai-fix 관례), 없으면 Accept-Language */
export function resolveApiLocale(req: Request): ApiLocale {
  const lang = new URL(req.url).searchParams.get("lang");
  if (lang === "en" || lang === "ko") return lang;
  return negotiateLocale(req);
}

function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** 코드 기반 에러 응답 — error는 로케일 번역, code/params는 클라이언트 번역용 */
export function apiError(
  locale: ApiLocale,
  code: ApiErrorCode,
  status: number,
  opts: { params?: Record<string, string | number>; extra?: Record<string, unknown> } = {},
): NextResponse {
  const template = MESSAGES[code][locale];
  const error = opts.params ? fill(template, opts.params) : template;
  return NextResponse.json(
    { error, code, ...(opts.params ? { params: opts.params } : {}), ...(opts.extra ?? {}) },
    { status },
  );
}
