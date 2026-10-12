import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "@/lib/billing/dbErrors";
import { shouldLog } from "@/lib/billing/logThrottle";
import { SELF_SERVE_PLAN_IDS, type PricingChannel } from "@/lib/billing/price";
import { logAppError } from "@/lib/logs";

export interface ShownPrice {
  id: string;
  plan_code: string;
  interval: "month" | "year";
  /** KRW는 원, USD는 cent */
  amount: number;
  currency: "KRW" | "USD";
}

/**
 * 요금제에 진열할 가격 — 로케일의 결제 경로(pricingChannel: ko는 토스·원화, en은 판매 대행 Polar·USD)·지금 모드의 활성 가격.
 * billing_prices는 service role 전용이라 관리자 클라이언트를 받는다. Polar 가격은 상품 id가 있어야 결제창을 열 수 있어 그런 행만 진열한다.
 * 0041 미적용(테이블 없음)이면 조용히 가격 없음, 그 밖의 오류는 기록하고 가격 없음 — 요금제 페이지는 늘 열린다.
 * 렌더마다 읽으므로 오류가 이어지는 동안 기록은 프로세스당 1분에 한 번(logThrottle). 월간을 연간보다 먼저 둔다.
 */
export async function loadShownPrices(admin: SupabaseClient, livemode: boolean, channel: PricingChannel): Promise<ShownPrice[]> {
  let query = admin
    .from("billing_prices")
    .select("id, plan_code, interval, amount, currency")
    .eq("provider", channel.provider)
    .eq("currency", channel.currency)
    .eq("livemode", livemode)
    .eq("active", true)
    .in("plan_code", [...SELF_SERVE_PLAN_IDS]);
  if (channel.provider === "mor") query = query.not("external_price_id", "is", null);
  const { data, error } = await query;
  if (error) {
    if (!isMissingTable(error) && shouldLog("pricing price lookup failed")) {
      await logAppError(admin, `pricing price lookup failed: ${error.message}`, { path: "pricing" });
    }
    return [];
  }
  return ((data as ShownPrice[] | null) ?? []).sort((a, b) => (a.interval === b.interval ? 0 : a.interval === "month" ? -1 : 1));
}
