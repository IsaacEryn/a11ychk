import "server-only";
import { PolarError } from "@/lib/billing/polar";
import { TossError } from "@/lib/billing/toss";

/**
 * 기록용 오류 문자열 — 결제사 오류(토스·Polar)는 코드와 상태만, 그 밖은 메시지(저장소·흐름의 오류 메시지에는 비밀 값이 들어가지
 * 않는다 — 각 모듈의 규칙). 500자에서 자른다. 결제 흐름·액션·라우트가 모두 이 함수 하나를 쓴다
 */
export const errorText = (e: unknown): string =>
  (e instanceof TossError || e instanceof PolarError ? `${e.code} (${e.status})` : e instanceof Error ? e.message : String(e)).slice(0, 500);
