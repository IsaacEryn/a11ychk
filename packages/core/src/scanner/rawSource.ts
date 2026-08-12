/**
 * 원본 HTML 소스 확보 — 마크업 유효성 검사(htmlValidity)의 입력.
 *
 * axe는 파서가 복구를 마친 DOM을 보므로, 열고 닫음·중첩 오류를 보려면 렌더링 전의
 * 원본 응답 본문이 필요하다. page.content()는 파서가 재직렬화한 결과라 쓸 수 없다.
 *
 * - http(s): goto가 반환한 메인 응답의 본문을 재사용한다 (추가 네트워크 요청 없음)
 * - file:  : Playwright의 file:// 응답 본문은 보장이 불확실해 fs로 직접 읽는다
 *
 * 실패는 전부 null 반환 — 원본을 못 얻으면 유효성 검사를 생략할 뿐, 스캔 자체를
 * 막지 않는다 (best-effort 원칙, customChecks와 동일).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Response } from "playwright-core";

/** 이 크기를 넘는 문서는 유효성 검사를 생략한다 (동기 파싱 비용 상한) */
export const RAW_SOURCE_MAX_BYTES = 3 * 1024 * 1024;

/**
 * 페이지의 원본 HTML 소스를 반환한다. 확보 불가·비HTML·초과 크기면 null.
 * @param url 페이지 최종 URL (page.url())
 * @param response page.goto가 반환한 메인 응답 (null 가능 — file:// 등)
 */
export async function getRawSource(url: string, response: Response | null): Promise<string | null> {
  try {
    if (url.startsWith("file:")) {
      const text = await readFile(fileURLToPath(url), "utf-8");
      return text.length <= RAW_SOURCE_MAX_BYTES ? text : null;
    }
    if (!response) return null;
    const contentType = (await response.headerValue("content-type")) ?? "";
    // HTML 응답이 아니면(파일 다운로드·JSON 등) 마크업 검사 대상이 아니다
    if (contentType && !contentType.includes("html")) return null;
    const body = await response.body();
    if (body.byteLength > RAW_SOURCE_MAX_BYTES) return null;
    return body.toString("utf-8");
  } catch {
    return null; // 응답 본문 소실(리다이렉트 체인·캐시) 등 — 검사 생략
  }
}
