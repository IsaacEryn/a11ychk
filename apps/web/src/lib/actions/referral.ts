"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, revalidateLocalized, type SaveState } from "./shared";

/**
 * 의심(suspect) 초대 건 소명 제출 — 초대자가 사유를 적으면 관리자 심사 대기.
 * referrals는 RLS 정책 0개(service role 전용)라 admin 클라이언트 + 소유자 필터로 갱신.
 */
export async function submitReferralAppeal(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const { user } = await requireUser();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const note = String(formData.get("note") ?? "").trim();
  if (!id.success || note.length === 0 || note.length > 500) return { error: "invalid" };

  const { data, error } = await createAdminClient()
    .from("referrals")
    .update({ appeal_note: note })
    .eq("id", id.data)
    .eq("referrer_id", user.id)
    .eq("status", "suspect")
    .select("id");
  if (error || !data || data.length === 0) return { error: "failed" };
  revalidateLocalized("/mypage");
  return { ok: true };
}
