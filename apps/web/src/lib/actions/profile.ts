"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isImpersonatingNickname } from "@/lib/nickname";
import { sendAdminInquiryAlert } from "@/lib/notify";
import { requireUser, revalidateAll, revalidateLocalized, type SaveState } from "./shared";

// ─────────────── 인증 ───────────────
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidateAll();
  redirect("/ko");
}

// ─────────────── 프로필 ───────────────
/** 닉네임 저장 결과 코드 (UI에서 next-intl로 번역) */
export interface NicknameState {
  ok?: boolean;
  /** "invalid" | "impersonation" | "failed" */
  error?: string;
}

export async function updateNickname(_prev: NicknameState, formData: FormData): Promise<NicknameState> {
  const { supabase, user } = await requireUser();
  const parsed = z.string().trim().min(1).max(30).safeParse(formData.get("nickname"));
  if (!parsed.success) return { error: "invalid" };

  // 관리자가 아니면 운영진 사칭 닉네임 차단
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && isImpersonatingNickname(parsed.data)) {
    return { error: "impersonation" };
  }

  const { error } = await supabase.from("profiles").update({ nickname: parsed.data }).eq("id", user.id);
  if (error) return { error: "failed" };
  revalidateLocalized("/mypage");
  return { ok: true };
}

/**
 * 보고서 우선 표준 저장. 빈 값은 미설정(null)으로 되돌려 locale 폴백을 따른다.
 * migration 0017 미적용 환경에서는 컬럼 부재로 실패 → "failed" 반환 (페이지는 정상).
 */
export async function updatePreferredStandard(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const { supabase, user } = await requireUser();
  const parsed = z.enum(["", "wcag", "kwcag"]).safeParse(formData.get("preferredStandard"));
  if (!parsed.success) return { error: "invalid" };

  const { error } = await supabase
    .from("profiles")
    .update({ preferred_standard: parsed.data === "" ? null : parsed.data })
    .eq("id", user.id);
  if (error) return { error: "failed" };
  revalidateLocalized("/mypage");
  return { ok: true };
}

// ─────────────── 문의 ───────────────
const InquirySchema = z.object({
  type: z.enum(["bug", "feature", "question"]),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

/**
 * 문의 등록. 실패해도 사용자가 이유를 알 수 있도록 결과 상태를 돌려준다(useActionState).
 * error: "invalid"(입력 검증) | "rateLimited"(단시간 과다) | "failed"(저장 실패)
 */
export async function createInquiry(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const { supabase, user } = await requireUser();
  const parsed = InquirySchema.safeParse({
    type: formData.get("type"),
    title: formData.get("title"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: "invalid" };
  // 레이트리밋 — 사용자당 최근 10분 내 5건 초과 시 거절 (스팸·테이블 팽창 방지)
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await supabase
    .from("inquiries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);
  if ((count ?? 0) >= 5) return { error: "rateLimited" };
  const { error } = await supabase.from("inquiries").insert({ user_id: user.id, ...parsed.data });
  if (error) return { error: "failed" };
  // 관리자 즉시 통지 (best-effort — 실패해도 문의 접수는 성공)
  const { data: profile } = await supabase.from("profiles").select("nickname").eq("id", user.id).maybeSingle();
  sendAdminInquiryAlert(parsed.data.title as string, (profile?.nickname as string | null) ?? null).catch(() => undefined);
  revalidateLocalized("/contact", "/inquiries", "/admin/inquiries");
  return { ok: true };
}
