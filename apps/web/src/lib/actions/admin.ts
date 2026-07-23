"use server";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { ASSIGNABLE_PLAN_IDS, MAX_PAGES_PER_SCAN } from "@/lib/quota";
import { setPlansActive } from "@/lib/appSettings";
import { logAdminAction } from "@/lib/logs";
import { requireAdmin, revalidateLocalized, type SaveState } from "./shared";

// ─────────────── 관리자 ───────────────
/** 관리자: GitHub 저장소 통계 즉시 수집 (크론이 밀렸을 때 수동 새로고침) */
export async function refreshRepoStats(): Promise<void> {
  const { user: actor } = await requireAdmin();
  const { collectRepoStats } = await import("@/lib/repoStats");
  try {
    await collectRepoStats();
    await logAdminAction(createAdminClient(), actor.id, "stats.refresh");
  } catch {
    // 토큰 부재·API 오류 — 조용히 무시 (지표는 다음 크론에 반영)
  }
  revalidateLocalized("/admin");
}

export async function toggleBlockUser(formData: FormData): Promise<void> {
  const { user: actor } = await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const blocked = formData.get("blocked") === "true";
  if (!id.success) return;
  const admin = createAdminClient();
  await admin.from("profiles").update({ blocked: !blocked }).eq("id", id.data);
  await logAdminAction(admin, actor.id, blocked ? "user.unblock" : "user.block", id.data);
  revalidateLocalized("/admin", "/admin/users");
}

async function readOverride(admin: SupabaseClient, userId: string): Promise<Record<string, unknown>> {
  const { data } = await admin.from("profiles").select("scan_limit_override").eq("id", userId).single();
  return data?.scan_limit_override && typeof data.scan_limit_override === "object"
    ? (data.scan_limit_override as Record<string, unknown>)
    : {};
}

/** 한도 초기화 결과 (useActionState 피드백용) */
export interface ResetQuotaState {
  ok?: boolean;
  resetScope?: "daily" | "weekly" | "monthly" | "all" | "extension";
  error?: string;
}

/**
 * 검사 한도 초기화. scope: daily | weekly | monthly | extension | all.
 * 웹 창(daily/weekly/monthly)은 리셋 시각(scan_limit_override.{window}ResetAt)을
 * 현재로 설정해 그 이전 검사를 집계에서 제외하고, extension은 extension_usage 행을
 * 삭제한다. all은 넷 모두 한 번에(진짜 일괄 초기화).
 */
export async function resetQuota(_prev: ResetQuotaState, formData: FormData): Promise<ResetQuotaState> {
  const { user: actor } = await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const scope = z.enum(["daily", "weekly", "monthly", "all", "extension"]).safeParse(formData.get("scope"));
  if (!id.success || !scope.success) return { error: "invalid" };

  const admin = createAdminClient();

  // 확장 사용량 초기화 — extension_usage 행 삭제 (웹 한도와 분리)
  if (scope.data === "extension") {
    const { error } = await admin.from("extension_usage").delete().eq("user_id", id.data);
    if (error) return { error: "failed" };
    await logAdminAction(admin, actor.id, "user.reset_quota", id.data, { scope: "extension" });
    revalidateLocalized("/admin/users", "/dashboard");
    return { ok: true, resetScope: scope.data };
  }

  const current = await readOverride(admin, id.data);
  const nowIso = new Date().toISOString();
  const windows = scope.data === "all" ? (["daily", "weekly", "monthly"] as const) : [scope.data];
  const patch: Record<string, string> = {};
  for (const w of windows) patch[`${w}ResetAt`] = nowIso;

  const { error } = await admin
    .from("profiles")
    .update({ scan_limit_override: { ...current, ...patch } })
    .eq("id", id.data);
  if (error) return { error: "failed" };

  // 일괄(all)은 확장 사용량까지 함께 초기화 — 실패해도 웹 창 초기화는 유지(부분 성공 허용)
  if (scope.data === "all") {
    await admin.from("extension_usage").delete().eq("user_id", id.data);
  }
  await logAdminAction(admin, actor.id, "user.reset_quota", id.data, { scope: scope.data });
  revalidateLocalized("/admin/users", "/dashboard");
  return { ok: true, resetScope: scope.data };
}

/** 사용자별 요금제·개별 최대 한도 설정. 빈 숫자는 개별값 제거(요금제 한도 사용) */
export async function setUserLimits(formData: FormData): Promise<void> {
  const { user: actor } = await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  // 달성 등급(plus1/plus2)은 초대·활동으로만 부여 — 관리자 배정 대상에서 제외
  const plan = z.enum(ASSIGNABLE_PLAN_IDS as [string, ...string[]]).safeParse(formData.get("plan"));
  if (!id.success || !plan.success) return;

  const admin = createAdminClient();
  const current = await readOverride(admin, id.data);
  const next: Record<string, unknown> = { ...current, plan: plan.data };

  for (const key of ["daily", "weekly", "monthly"] as const) {
    const raw = formData.get(key);
    const str = typeof raw === "string" ? raw.trim() : "";
    if (str === "") {
      delete next[key]; // 개별 한도 해제 → 요금제 한도 적용
    } else {
      const n = Number(str);
      if (Number.isInteger(n) && n >= 0 && n <= 100000) next[key] = n;
    }
  }

  // 사용자별 기본 페이지 한도 (소유 확인 도메인은 ×2, 최대 MAX_PAGES_PER_SCAN)
  {
    const raw = formData.get("pages");
    const str = typeof raw === "string" ? raw.trim() : "";
    if (str === "") {
      delete next.pages;
    } else {
      const n = Number(str);
      if (Number.isInteger(n) && n >= 1 && n <= MAX_PAGES_PER_SCAN) next.pages = n;
    }
  }

  // 확장 일일 검사 한도 (웹 검사 한도와 분리)
  {
    const raw = formData.get("extDaily");
    const str = typeof raw === "string" ? raw.trim() : "";
    if (str === "") {
      delete next.extDaily;
    } else {
      const n = Number(str);
      if (Number.isInteger(n) && n >= 0 && n <= 10000) next.extDaily = n;
    }
  }

  await admin.from("profiles").update({ scan_limit_override: next }).eq("id", id.data);
  await logAdminAction(admin, actor.id, "user.set_limits", id.data, {
    plan: plan.data,
    ...Object.fromEntries(
      (["daily", "weekly", "monthly", "pages", "extDaily"] as const)
        .filter((k) => next[k] !== undefined)
        .map((k) => [k, next[k]]),
    ),
  });
  revalidateLocalized("/admin/users", "/dashboard");
}

/** 요금제 시행 시작/중지 — app_settings.plans.active 토글 */
export async function togglePlansActive(formData: FormData): Promise<void> {
  const { user: actor } = await requireAdmin();
  const active = formData.get("active") === "true";
  const admin = createAdminClient();
  await setPlansActive(admin, !active);
  await logAdminAction(admin, actor.id, "plans.toggle", undefined, { active: !active });
  revalidateLocalized("/admin", "/admin/settings", "/dashboard");
}

/** 요금제(그룹) 일괄 배정 — 전체 사용자를 지정 요금제로. 개별 한도 override(횟수·페이지)는 제거 */
export async function bulkSetPlan(formData: FormData): Promise<void> {
  const { user: actor } = await requireAdmin();
  // 달성 등급(plus1/plus2)은 초대·활동으로만 부여 — 관리자 배정 대상에서 제외
  const plan = z.enum(ASSIGNABLE_PLAN_IDS as [string, ...string[]]).safeParse(formData.get("plan"));
  if (!plan.success) return;

  const admin = createAdminClient();
  const { data: users } = await admin.from("profiles").select("id, scan_limit_override");
  for (const u of users ?? []) {
    const current =
      u.scan_limit_override && typeof u.scan_limit_override === "object"
        ? (u.scan_limit_override as Record<string, unknown>)
        : {};
    // 개별 한도(daily/weekly/monthly/pages)는 제거하고 요금제만 지정 (그룹 일괄 정책 우선)
    const next: Record<string, unknown> = { plan: plan.data };
    for (const k of ["dailyResetAt", "weeklyResetAt", "monthlyResetAt"] as const) {
      if (current[k] !== undefined) next[k] = current[k];
    }
    await admin.from("profiles").update({ scan_limit_override: next }).eq("id", u.id);
  }
  await logAdminAction(admin, actor.id, "plans.bulk_set", undefined, {
    plan: plan.data,
    count: users?.length ?? 0,
  });
  revalidateLocalized("/admin/users");
}

/** 페이지 한도 일괄 설정 — 전체 사용자의 scan_limit_override.pages를 지정/해제 (다른 키는 보존) */
export async function bulkSetPages(formData: FormData): Promise<void> {
  const { user: actor } = await requireAdmin();
  const raw = formData.get("pages");
  const str = typeof raw === "string" ? raw.trim() : "";
  let pages: number | null = null; // null = 해제 (요금제/기본 한도로 복귀)
  if (str !== "") {
    const n = Number(str);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAGES_PER_SCAN) return;
    pages = n;
  }

  const admin = createAdminClient();
  const { data: users } = await admin.from("profiles").select("id, scan_limit_override");
  for (const u of users ?? []) {
    const current =
      u.scan_limit_override && typeof u.scan_limit_override === "object"
        ? (u.scan_limit_override as Record<string, unknown>)
        : {};
    const next: Record<string, unknown> = { ...current };
    if (pages === null) delete next.pages;
    else next.pages = pages;
    await admin.from("profiles").update({ scan_limit_override: next }).eq("id", u.id);
  }
  await logAdminAction(admin, actor.id, "pages.bulk_set", undefined, {
    pages,
    count: users?.length ?? 0,
  });
  revalidateLocalized("/admin/users");
}

export async function replyInquiry(formData: FormData): Promise<void> {
  const { user: actor } = await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const reply = z.string().trim().min(1).max(5000).safeParse(formData.get("reply"));
  if (!id.success || !reply.success) return;
  const admin = createAdminClient();
  await admin
    .from("inquiries")
    .update({ admin_reply: reply.data, status: "answered", replied_at: new Date().toISOString() })
    .eq("id", id.data);
  await logAdminAction(admin, actor.id, "inquiry.reply", id.data);
  revalidateLocalized("/contact", "/admin/inquiries");
}

// ─────────────── 초대 관리 (referrals — migration 0024) ───────────────

/** 의심(suspect) 초대 건 승인 → valid 전환 + 목표 도달 시 승급 재평가 */
export async function approveReferral(formData: FormData): Promise<void> {
  const { user: actor } = await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const admin = createAdminClient();
  const { data } = await admin
    .from("referrals")
    .update({ status: "valid", validated_at: new Date().toISOString(), suspect_reason: null })
    .eq("id", id.data)
    .eq("status", "suspect")
    .select("referrer_id");
  const referrerId = data?.[0]?.referrer_id as string | undefined;
  if (referrerId) {
    await logAdminAction(admin, actor.id, "referral.approve", id.data);
    // 승인으로 성립 수가 늘었으니 달성 등급 재평가 (플러스1/플러스2)
    const { reevaluateEarnedPlan } = await import("@/lib/referral/promote");
    await reevaluateEarnedPlan(admin, referrerId);
  }
  revalidateLocalized("/admin/referrals");
}

/** 의심 초대 건 기각 → rejected + 피초대자 가입 보너스 회수 (부정 건 베네핏 박탈) */
export async function rejectReferral(formData: FormData): Promise<void> {
  const { user: actor } = await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const admin = createAdminClient();
  const { data } = await admin
    .from("referrals")
    .update({ status: "rejected" })
    .eq("id", id.data)
    .eq("status", "suspect")
    .select("invitee_id");
  if (data && data.length > 0) {
    const inviteeId = data[0]?.invitee_id as string | null;
    if (inviteeId) {
      await admin.from("profiles").update({ referral_daily_bonus: 0 }).eq("id", inviteeId);
    }
    await logAdminAction(admin, actor.id, "referral.reject", id.data);
  }
  revalidateLocalized("/admin/referrals");
}

/** 달성 등급(earned_plan) 해제 — 어뷰즈 확정 시 제재용 */
export async function clearEarnedPlan(formData: FormData): Promise<void> {
  const { user: actor } = await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("userId"));
  if (!id.success) return;
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .update({ earned_plan: null })
    .eq("id", id.data)
    .not("earned_plan", "is", null)
    .select("id");
  if (data && data.length > 0) {
    await logAdminAction(admin, actor.id, "referral.clearEarned", id.data);
  }
  revalidateLocalized("/admin/users", "/admin/referrals");
}

// ─────────────── 관리자 → 사용자 메일 ───────────────

const SendEmailSchema = z.object({
  userId: z.string().uuid(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

/**
 * 관리자가 사용자에게 직접 메일 발송 (useActionState 피드백).
 * 이메일은 profiles가 아닌 auth에서 조회하고, 본문은 notify에서 escapeHtml 처리된다.
 */
export async function sendUserEmail(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const { user: actor } = await requireAdmin();
  const parsed = SendEmailSchema.safeParse({
    userId: formData.get("userId"),
    subject: formData.get("subject"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: "invalid" };

  const admin = createAdminClient();
  const { data: target } = await admin.auth.admin.getUserById(parsed.data.userId);
  const to = target?.user?.email;
  if (!to) return { error: "noEmail" };

  const { sendAdminUserEmail } = await import("@/lib/notify");
  const sent = await sendAdminUserEmail({ to, subject: parsed.data.subject, body: parsed.data.body });
  if (!sent) return { error: "sendFailed" };

  await logAdminAction(admin, actor.id, "user.email", parsed.data.userId, {
    subject: parsed.data.subject.slice(0, 120),
  });
  return { ok: true };
}

// ─────────────── 관리자 재검사 (실패 검사, 한도 미차감) ───────────────

/**
 * 실패한 검사를 관리자가 재실행한다. 사용자 검사 한도를 차감하지 않으며(admin_retry, 0028),
 * 성공(done)한 경우에만 해당 사용자에게 노출된다 — 실패는 관리자 목록에만 보인다.
 */
export async function adminRetryScan(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const { user: actor } = await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "invalid" };

  const admin = createAdminClient();
  const { data: orig } = await admin
    .from("scans")
    .select("id, user_id, root_url, scope, page_limit, status")
    .eq("id", id.data)
    .single();
  if (!orig) return { error: "notFound" };
  if (orig.status !== "failed") return { error: "notFailed" };

  const { assertPublicHttpUrl } = await import("@a11ychk/core");
  let url: URL;
  try {
    url = await assertPublicHttpUrl(orig.root_url as string);
  } catch {
    return { error: "invalidUrl" };
  }

  const { createScanForUser, DEFAULT_SCOPE } = await import("@/lib/scan/createScan");
  const result = await createScanForUser(
    orig.user_id as string,
    url,
    (orig.scope as import("@a11ychk/core").EvaluationScope | null) ?? DEFAULT_SCOPE,
    { adminRetry: true, requestedPages: (orig.page_limit as number | null) ?? undefined },
  );
  if (!result.ok) {
    // 409 = 해당 사용자에게 진행 중 검사 존재, 그 외 = 생성 실패(0028 미적용 포함)
    return { error: result.status === 409 ? "userBusy" : "createFailed" };
  }

  const { after } = await import("next/server");
  const { runScan } = await import("@/lib/scan/runScan");
  after(() => runScan(result.id));

  await logAdminAction(admin, actor.id, "scan.admin_retry", id.data, { newScanId: result.id });
  revalidateLocalized("/admin/scans");
  return { ok: true };
}
