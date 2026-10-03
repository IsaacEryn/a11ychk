/**
 * KWCAG 항목 슬러그 — 항목의 고정 식별자.
 *
 * 공개 주소(/guide/{slug})이면서 저장·전송 키다. 번호(ksNo·serial)는 표준이 개정되면 바뀌지만
 * 슬러그는 바뀌지 않는다. 주소가 바뀌면 검색 색인과 외부 링크가 끊기고, 저장된 판정이 다른
 * 항목으로 읽힌다. 값은 kwcag.ts의 각 항목에 직접 적혀 있고 테스트가 33개 모두 고정한다.
 */
import { KWCAG_ITEMS } from "./kwcag";
import type { KwcagItem, KwcagSlug } from "../types";

/** @deprecated item.slug를 쓴다. 이전 작업이 끝나면 지운다 */
export function kwcagSlug(item: KwcagItem): string {
  return item.slug;
}

export const KWCAG_SLUGS: readonly KwcagSlug[] = KWCAG_ITEMS.map((item) => item.slug);

export const KWCAG_BY_SLUG: ReadonlyMap<string, KwcagItem> = new Map(KWCAG_ITEMS.map((item) => [item.slug, item]));

/** 슬러그 목록 → 항목(일련번호 순). 모르는 값은 뺀다 — 규칙의 kwcag 배열을 표시할 때 쓴다 */
export function kwcagItemsOf(slugs: readonly string[]): KwcagItem[] {
  return slugs
    .map((s) => KWCAG_BY_SLUG.get(s))
    .filter((i): i is KwcagItem => !!i)
    .sort((a, b) => a.serial - b.serial);
}
