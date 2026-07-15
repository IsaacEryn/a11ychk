import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 요금제 시행 활성 여부. 기본 false(비활성) — 전원 free 등급으로 동작한다.
 * 관리자가 준비를 마친 뒤 관리자 페이지에서 활성화하면 배정된 요금제가 발효된다.
 */
export async function getPlansActive(db: SupabaseClient): Promise<boolean> {
  const { data } = await db.from("app_settings").select("value").eq("key", "plans").maybeSingle();
  const v = data?.value as { active?: boolean } | undefined;
  return v?.active === true;
}

export async function setPlansActive(admin: SupabaseClient, active: boolean): Promise<void> {
  await admin
    .from("app_settings")
    .upsert({ key: "plans", value: { active }, updated_at: new Date().toISOString() }, { onConflict: "key" });
}
