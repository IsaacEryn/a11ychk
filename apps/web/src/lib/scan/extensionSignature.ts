/**
 * 크롬 확장이 저장 요청에 실어 보내는 페이지 시그니처 검증.
 *
 * 확장은 core의 collectPageSignature(서버 SIGNATURE_SCRIPT와 패리티 테스트로 묶인 함수)로
 * 상위 문서의 시그니처를 모아 보낸다. 서버는 이 값으로 웹·티저와 같은 siteLevelOptions를 넘겨
 * 집계하고, scan_pages.signature에 저장해 재집계(reaggregate) 때도 같은 판단을 유지한다.
 * 클라이언트 값이므로 모양과 크기를 스키마로 확인하고, 틀리면 버리고(null) '해당 없음' 판단을 보류한다.
 * 시그니처 하나 때문에 검사 결과 저장 자체를 거절하지는 않는다.
 */
import { z } from "zod";
import type { PageSignature } from "@a11ychk/core";

// 상한은 수집기가 내는 크기(링크 텍스트 60자·내비 링크 40개·확인용 자료 항목당 8개·120자)보다 넉넉하게 둔다
const SampleSchema = z.object({
  selector: z.string().max(2000),
  text: z.string().max(200),
});

export const ExtensionSignatureSchema = z.object({
  title: z.string().max(2000),
  navLinks: z.array(z.string().max(200)).max(40),
  hasSearch: z.boolean(),
  hasSitemap: z.boolean(),
  hasMedia: z.boolean(),
  review: z
    .object({
      alts: z.array(SampleSchema).max(8),
      labels: z.array(SampleSchema).max(8),
      genericLinks: z.array(SampleSchema).max(8),
    })
    .optional(),
});

/**
 * 확장이 보낸 시그니처를 저장·집계용 PageSignature로 만든다. 없거나 모양이 틀리면 null.
 * url은 확장이 보낸 값을 쓰지 않고 저장할 페이지의 url로 둔다(정의되지 않은 키는 스키마가 버린다).
 */
export function parseExtensionSignature(raw: unknown, pageUrl: string): PageSignature | null {
  if (raw === undefined || raw === null) return null;
  const parsed = ExtensionSignatureSchema.safeParse(raw);
  return parsed.success ? { url: pageUrl, ...parsed.data } : null;
}
