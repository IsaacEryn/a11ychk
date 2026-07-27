/**
 * KWCAG 항목의 URL 슬러그.
 *
 * 항목 상세 페이지 주소를 `/guide/5.1.1` 대신 말이 되는 문자열로 쓰기 위한 것이다.
 * 사람이 주소만 보고 무슨 항목인지 알 수 있고, 검색엔진에도 단서가 된다.
 *
 * 기본은 영문 항목명을 케밥 케이스로 바꾼 값이고, 그 결과가 지저분해지는 몇 개만
 * 아래 표에서 손으로 잡아 준다. 슬러그가 겹치면 안 되고 한번 정하면 바꾸면 안 된다
 * (주소가 바뀌면 그동안 쌓인 검색 색인과 외부 링크가 끊긴다) — 테스트로 고정해 뒀다.
 */
import { KWCAG_ITEMS } from "./kwcag";
import type { KwcagItem } from "../types";

/** 파생 결과가 길거나 어색한 항목만 지정 (괄호·슬래시·앰퍼샌드가 섞인 이름들) */
const SLUG_OVERRIDES: Record<string, string> = {
  "5.1.1": "alternative-text",
  "6.1.3": "target-size",
  "6.4.4": "consistent-reference-locators",
  "7.4.2": "error-identification",
  "8.1.1": "valid-markup",
  "8.2.1": "aria-accessibility",
};

function derive(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function kwcagSlug(item: KwcagItem): string {
  const override = SLUG_OVERRIDES[item.id];
  if (override) return override;
  const en = item.name.en;
  // LocalizedText.en은 선택 항목이라 없을 수 있다. 한글명으로는 주소를 만들 수 없으니
  // 그런 항목은 위 표에 직접 넣어야 한다. 모듈 평가 시점에 터지므로 빌드에서 바로 걸린다.
  if (!en) {
    throw new Error(`KWCAG ${item.id}: 영문 항목명이 없어 슬러그를 만들 수 없다 — SLUG_OVERRIDES에 지정할 것`);
  }
  return derive(en);
}

export const KWCAG_SLUGS: readonly string[] = KWCAG_ITEMS.map(kwcagSlug);

export const KWCAG_BY_SLUG: ReadonlyMap<string, KwcagItem> = new Map(
  KWCAG_ITEMS.map((item) => [kwcagSlug(item), item]),
);
