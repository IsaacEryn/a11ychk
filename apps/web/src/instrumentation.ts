/**
 * 자체 에러 모니터링 — 처리되지 않은 서버 오류를 app_errors 테이블에 기록하고(migration 0008),
 * 24시간 안에 처음 보는 오류면 관리자에게 메일로 알린다. 관리자 콘솔 /admin/logs에서 확인.
 * 기록·알림의 동작은 lib/errorReport.ts에 있다(이 파일은 Next의 훅 연결만 한다).
 */
import type { Instrumentation } from "next";
import { reportRequestError } from "./lib/errorReport";

export const onRequestError: Instrumentation.onRequestError = (error, request, context) =>
  reportRequestError(error, request, context);
