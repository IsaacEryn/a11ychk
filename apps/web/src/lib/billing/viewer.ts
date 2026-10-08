import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { billingTestUserIds } from "./config";
import { ANONYMOUS_VIEWER, type Viewer } from "./visibility";

/** 결제 공개 범위용 시청자 판정 — 관리자 여부는 profiles.role(결제 화면은 관리자 2단계 인증을 요구하지 않는다) */
export async function loadViewer(db: SupabaseClient, userId: string | null): Promise<Viewer> {
  if (!userId) return ANONYMOUS_VIEWER;
  const { data } = await db.from("profiles").select("role").eq("id", userId).maybeSingle();
  return { isAdmin: data?.role === "admin", isTester: billingTestUserIds().has(userId) };
}
