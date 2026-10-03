/**
 * 저장된 KWCAG 값을 지금 카탈로그에 맞추는 순수 함수들.
 * 숫자 꼴은 옛 a11ychk 번호로만 해석한다(kwcagLegacy.ts 참고). 웹·확장이 DB와 브라우저 저장소에서
 * 읽은 값을 쓰기 전에 한 번씩 거친다.
 */
import { WCAG_BY_ID } from "./wcag";
import { KWCAG_BY_SLUG } from "./kwcagSlug";
import { kwcagFromStored } from "./kwcagLegacy";
import type { KwcagMatrixRow } from "../types";

/**
 * 저장된 KWCAG 매트릭스 → 슬러그 키, 공식 순서(일련번호).
 * 모르는 행은 버리고, 같은 항목에 옛 번호 행과 슬러그 행이 함께 있으면 슬러그 행을 쓴다.
 */
export function normalizeKwcagMatrix(rows: readonly KwcagMatrixRow[] | null | undefined): KwcagMatrixRow[] {
  const bySlug = new Map<string, { row: KwcagMatrixRow; serial: number; fromSlug: boolean }>();
  for (const row of rows ?? []) {
    const item = kwcagFromStored(row.itemId);
    if (!item) continue;
    const fromSlug = row.itemId === item.slug;
    const prev = bySlug.get(item.slug);
    if (prev && (prev.fromSlug || !fromSlug)) continue;
    bySlug.set(item.slug, { row: { ...row, itemId: item.slug }, serial: item.serial, fromSlug });
  }
  return [...bySlug.values()].sort((a, b) => a.serial - b.serial).map((v) => v.row);
}

/** scan_reviews 행 꼴 — standard와 item_id만 본다. 나머지 필드는 그대로 둔다 */
export interface StoredReviewRow {
  standard: string;
  item_id: string;
}

/**
 * 저장된 판정 행 → kwcag 행의 item_id를 슬러그로 맞춘다. wcag 행은 그대로 둔다.
 * 풀 수 없는 kwcag 행은 버리고, 같은 항목의 옛 행·슬러그 행이 함께 있으면 슬러그 행을 쓴다
 * (배포 뒤에는 슬러그로만 쓰므로 슬러그 행이 늘 더 새 판정이다). 행 순서는 유지한다.
 * 한 검사(scan)의 행만 넘긴다 — scan_id 없이 항목으로 중복을 거른다.
 */
export function normalizeReviewRows<T extends StoredReviewRow>(rows: readonly T[] | null | undefined): T[] {
  const list = rows ?? [];
  const slugKeyed = new Set<string>();
  for (const r of list) if (r.standard === "kwcag" && KWCAG_BY_SLUG.has(r.item_id)) slugKeyed.add(r.item_id);
  const out: T[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    if (r.standard !== "kwcag") {
      out.push(r);
      continue;
    }
    const item = kwcagFromStored(r.item_id);
    if (!item) continue;
    const isSlug = r.item_id === item.slug;
    if (!isSlug && slugKeyed.has(item.slug)) continue; // 같은 항목의 슬러그 행이 따로 있다
    if (seen.has(item.slug)) continue;
    seen.add(item.slug);
    out.push(isSlug ? r : { ...r, item_id: item.slug });
  }
  return out;
}

/** 키가 KWCAG 항목인 맵 → 슬러그 키. 같은 항목이면 슬러그 키의 값을 쓰고, 모르는 키는 버린다 */
export function normalizeKwcagKeys<V>(map: Readonly<Record<string, V>>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [key, value] of Object.entries(map)) {
    if (KWCAG_BY_SLUG.has(key)) out[key] = value;
  }
  for (const [key, value] of Object.entries(map)) {
    if (KWCAG_BY_SLUG.has(key)) continue;
    const item = kwcagFromStored(key);
    if (item && !(item.slug in out)) out[item.slug] = value;
  }
  return out;
}

/**
 * 확장 저장소(review:<url>)의 판정 키 정리 — 순수 함수, 멱등.
 * - 1~4.x.x: WCAG 성공기준 키 → 그대로
 * - 5~8.x.x: 옛 a11ychk 번호 → 대응 SC가 있으면 SC 키로 옮기고(이미 있는 SC 판정은 덮지 않음),
 *   없으면(KWCAG 고유 항목) 슬러그 키로 옮긴 뒤 원래 키를 지운다. 풀 수 없는 숫자 키는 그대로 둔다.
 * - 그 밖(슬러그): 그대로
 * 공식 번호로 풀면 안 된다 — 옛 "5.4.3"(콘텐츠 간의 구분)이 공식 5.4.3(명도 대비)으로 읽혀
 * 1.4.3 판정으로 둔갑한다.
 */
export function migrateReviewKeys<V extends object>(
  map: Readonly<Record<string, V>>,
): { map: Record<string, V>; changed: boolean } {
  let changed = false;
  const out: Record<string, V> = { ...map };
  for (const [key, entry] of Object.entries(map)) {
    if (!/^[5-8]\./.test(key)) continue;
    const item = kwcagFromStored(key);
    if (!item) continue;
    const scs = item.wcag.filter((sc) => WCAG_BY_ID.has(sc));
    const targets = scs.length > 0 ? scs : [item.slug];
    for (const target of targets) {
      if (!out[target]) out[target] = { ...entry };
    }
    delete out[key];
    changed = true;
  }
  return { map: out, changed };
}
