import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WcagOutcome } from "@a11ychk/core";

export interface WcagReview {
  outcome: WcagOutcome;
  note: string;
}

/**
 * 내보내기(EARL·WCAG-EM Report Tool)가 공유하는 점검자 판정 로더 — 사이트 단위 WCAG 판정만.
 * 두 형식이 같은 검사에서 다른 결론을 내지 않도록 합치는 규칙을 한 곳에 둔다:
 * 점검자 판정이 있으면 자동 결과를 대체하고(mode=manual), 없으면 자동 결과 그대로(mode=automatic).
 * 페이지별 판정(page_outcomes)은 사이트 단위 assertion에는 싣지 않는다 — 두 형식 모두 동일.
 */
export async function loadWcagReviews(supabase: SupabaseClient, scanId: string): Promise<Map<string, WcagReview>> {
  const { data } = await supabase.from("scan_reviews").select("standard, item_id, outcome, note").eq("scan_id", scanId);
  const map = new Map<string, WcagReview>();
  for (const r of data ?? []) {
    if (r.standard === "wcag") map.set(r.item_id, { outcome: r.outcome as WcagOutcome, note: (r.note as string | null) ?? "" });
  }
  return map;
}
