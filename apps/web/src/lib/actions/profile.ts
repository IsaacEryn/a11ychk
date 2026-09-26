"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isImpersonatingNickname } from "@/lib/nickname";
import { sendAdminInquiryAlert } from "@/lib/notify";
import { logAppError } from "@/lib/logs";
import { accountDeleteConfirmPhrase, confirmMatches } from "@/lib/accountDelete";
import { actionLocale, requireUser, revalidateAll, revalidateLocalized, type SaveState } from "./shared";

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

// ─────────────── 회원 탈퇴 ───────────────
/**
 * 회원 탈퇴(계정 삭제) — 개인정보처리방침 7항이 약속한 셀프 탈퇴.
 *
 * auth.users를 지우면 profiles가 on delete cascade로 지워지고, 거기 걸린 도메인·검사·페이지·
 * 위반·점검자 판정·문의·프리셋·확장 사용량, 그리고 이 사용자가 **보낸** 초대 기록(referrer_id cascade)이
 * 따라 지워진다. 남는 것: 로그인 기록(user_id만 set null — 이메일·IP·UA 스냅샷은 기록일부터 90일),
 * 이 사용자가 **받은** 초대 기록(invitee_id set null — 이메일 해시·가입 IP 90일), 관리자 열람 감사 기록
 * (audit_logs, FK 없음). 탈퇴 화면 안내(mypage.account.kept)와 맞춰 둘 것.
 *
 * 거절 조건: 확인 문구 불일치 · 관리자 계정(콘솔 잠김 방지 — 권한을 넘긴 뒤 탈퇴) ·
 * 진행 중 검사(실행 중인 함수가 지워진 검사에 결과를 쓰다 실패한다).
 * error: "mismatch" | "admin" | "active" | "failed"
 */
export async function deleteAccount(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const { supabase, user } = await requireUser();
  if (!confirmMatches(accountDeleteConfirmPhrase(user.email), formData.get("confirm"))) {
    return { error: "mismatch" };
  }

  // 관리자 판정 조회가 실패하면 진행하지 않는다(관리자 계정이 오류 한 번에 지워지는 일 방지).
  // 단 profiles 행 자체가 없는 계정(PGRST116)은 관리자가 아니므로 막지 않는다 — 막으면 영영 탈퇴 못 한다.
  const { data: profile, error: profileErr } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profileErr && profileErr.code !== "PGRST116") return { error: "failed" };
  if (profile?.role === "admin") return { error: "admin" };

  const admin = createAdminClient();
  const { count } = await admin
    .from("scans")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .in("status", ["queued", "running"]);
  if ((count ?? 0) > 0) return { error: "active" };

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    await logAppError(admin, `account delete failed: ${error.message.slice(0, 300)}`, { path: "actions.deleteAccount" });
    return { error: "failed" };
  }

  // 사용자는 이미 없으므로 서버 로그아웃 호출 없이 이 브라우저의 세션 쿠키만 지운다
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  revalidateAll();
  redirect(`/${await actionLocale()}/login?reason=deleted`);
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
  revalidateLocalized("/inquiries", "/admin/inquiries");
  return { ok: true };
}
