"use server";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_PAGES_PER_SCAN, PLAN_IDS } from "@/lib/quota";
import { setPlansActive } from "@/lib/appSettings";
import { logAdminAction } from "@/lib/logs";
import { requireAdmin, revalidateLocalized } from "./shared";

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
 * 검사 한도 초기화. scope: daily | weekly | monthly | all.
 * 해당 윈도우의 리셋 시각(scan_limit_override.{window}ResetAt)을 현재로 설정해
 * 그 이전 검사를 사용량 집계에서 제외한다.
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
  await logAdminAction(admin, actor.id, "user.reset_quota", id.data, { scope: scope.data });
  revalidateLocalized("/admin/users", "/dashboard");
  return { ok: true, resetScope: scope.data };
}

/** 사용자별 요금제·개별 최대 한도 설정. 빈 숫자는 개별값 제거(요금제 한도 사용) */
export async function setUserLimits(formData: FormData): Promise<void> {
  const { user: actor } = await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const plan = z.enum(PLAN_IDS as [string, ...string[]]).safeParse(formData.get("plan"));
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
  const plan = z.enum(PLAN_IDS as [string, ...string[]]).safeParse(formData.get("plan"));
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
