"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resolveTxt } from "node:dns/promises";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { guardedFetch } from "@a11ychk/core";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isImpersonatingNickname } from "@/lib/nickname";
import { PLAN_IDS } from "@/lib/quota";
import { setPlansActive } from "@/lib/appSettings";

/** 모든 로케일 경로 캐시 무효화 (단순화를 위해 layout 단위) */
function revalidateAll() {
  revalidatePath("/", "layout");
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/ko/login");
  return { supabase, user };
}

async function requireAdmin() {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/ko/dashboard");
  return { supabase, user };
}

// ─────────────── 인증 ───────────────
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidateAll();
  redirect("/ko");
}

// ─────────────── 도메인 ───────────────
const HostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/, "올바른 도메인 형식이 아닙니다.");

export async function addDomain(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const raw = String(formData.get("hostname") ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const parsed = HostnameSchema.safeParse(raw);
  if (!parsed.success) return;
  await supabase.from("domains").insert({ user_id: user.id, hostname: parsed.data });
  revalidateAll();
}

export async function deleteDomain(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  await supabase.from("domains").delete().eq("id", id.data).eq("user_id", user.id);
  revalidateAll();
}

/** 도메인 정기 자동 스캔 켜기/끄기 */
export async function toggleAutoScan(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const enabled = formData.get("enabled") === "true";
  if (!id.success) return;
  await supabase.from("domains").update({ auto_scan: !enabled }).eq("id", id.data).eq("user_id", user.id);
  revalidateAll();
}

/** DNS TXT(_a11ychk.호스트) 또는 홈페이지 메타태그로 소유 확인 */
export async function verifyDomain(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const idParsed = z.string().uuid().safeParse(formData.get("id"));
  if (!idParsed.success) return;

  const { data: domain } = await supabase
    .from("domains")
    .select("id, hostname, verify_token, verified")
    .eq("id", idParsed.data)
    .eq("user_id", user.id)
    .single();
  if (!domain || domain.verified) return;

  let method: "dns_txt" | "meta_tag" | null = null;

  // 1) DNS TXT
  try {
    const records = await resolveTxt(`_a11ychk.${domain.hostname}`);
    if (records.some((chunks) => chunks.join("").trim() === domain.verify_token)) {
      method = "dns_txt";
    }
  } catch {
    // 레코드 없음 — 메타태그로 진행
  }

  // 2) 메타태그
  if (!method) {
    try {
      const res = await guardedFetch(`https://${domain.hostname}/`);
      if (res.ok) {
        const html = (await res.text()).slice(0, 500_000);
        const re = new RegExp(
          `<meta[^>]+name=["']a11ychk-verify["'][^>]+content=["']${domain.verify_token}["']|<meta[^>]+content=["']${domain.verify_token}["'][^>]+name=["']a11ychk-verify["']`,
          "i",
        );
        if (re.test(html)) method = "meta_tag";
      }
    } catch {
      // 접속 실패 — 미확인 유지
    }
  }

  if (method) {
    // verified 갱신은 service role로 (verify_method 포함)
    const admin = createAdminClient();
    await admin.from("domains").update({ verified: true, verify_method: method }).eq("id", domain.id);
  }
  revalidateAll();
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
  revalidateAll();
  return { ok: true };
}

// ─────────────── 문의 ───────────────
const InquirySchema = z.object({
  type: z.enum(["bug", "feature", "question"]),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

export async function createInquiry(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const parsed = InquirySchema.safeParse({
    type: formData.get("type"),
    title: formData.get("title"),
    body: formData.get("body"),
  });
  if (!parsed.success) return;
  await supabase.from("inquiries").insert({ user_id: user.id, ...parsed.data });
  revalidateAll();
}

// ─────────────── 관리자 ───────────────
export async function toggleBlockUser(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const blocked = formData.get("blocked") === "true";
  if (!id.success) return;
  const admin = createAdminClient();
  await admin.from("profiles").update({ blocked: !blocked }).eq("id", id.data);
  revalidateAll();
}

async function readOverride(admin: SupabaseClient, userId: string): Promise<Record<string, unknown>> {
  const { data } = await admin.from("profiles").select("scan_limit_override").eq("id", userId).single();
  return data?.scan_limit_override && typeof data.scan_limit_override === "object"
    ? (data.scan_limit_override as Record<string, unknown>)
    : {};
}

/**
 * 검사 한도 초기화. scope: daily | weekly | monthly | all.
 * 해당 윈도우의 리셋 시각(scan_limit_override.{window}ResetAt)을 현재로 설정해
 * 그 이전 검사를 사용량 집계에서 제외한다.
 */
export async function resetQuota(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const scope = z.enum(["daily", "weekly", "monthly", "all"]).safeParse(formData.get("scope"));
  if (!id.success || !scope.success) return;

  const admin = createAdminClient();
  const current = await readOverride(admin, id.data);
  const nowIso = new Date().toISOString();
  const windows = scope.data === "all" ? (["daily", "weekly", "monthly"] as const) : [scope.data];
  const patch: Record<string, string> = {};
  for (const w of windows) patch[`${w}ResetAt`] = nowIso;

  await admin
    .from("profiles")
    .update({ scan_limit_override: { ...current, ...patch } })
    .eq("id", id.data);
  revalidateAll();
}

/** 사용자별 요금제·개별 최대 한도 설정. 빈 숫자는 개별값 제거(요금제 한도 사용) */
export async function setUserLimits(formData: FormData): Promise<void> {
  await requireAdmin();
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

  await admin.from("profiles").update({ scan_limit_override: next }).eq("id", id.data);
  revalidateAll();
}

/** 요금제 시행 시작/중지 — app_settings.plans.active 토글 */
export async function togglePlansActive(formData: FormData): Promise<void> {
  await requireAdmin();
  const active = formData.get("active") === "true";
  await setPlansActive(createAdminClient(), !active);
  revalidateAll();
}

/** 요금제(그룹) 일괄 배정 — 전체 사용자를 지정 요금제로. 개별 한도 override는 제거 */
export async function bulkSetPlan(formData: FormData): Promise<void> {
  await requireAdmin();
  const plan = z.enum(PLAN_IDS as [string, ...string[]]).safeParse(formData.get("plan"));
  if (!plan.success) return;

  const admin = createAdminClient();
  const { data: users } = await admin.from("profiles").select("id, scan_limit_override");
  for (const u of users ?? []) {
    const current =
      u.scan_limit_override && typeof u.scan_limit_override === "object"
        ? (u.scan_limit_override as Record<string, unknown>)
        : {};
    // 개별 한도(daily/weekly/monthly)는 제거하고 요금제만 지정 (그룹 일괄 정책 우선)
    const next: Record<string, unknown> = { plan: plan.data };
    for (const k of ["dailyResetAt", "weeklyResetAt", "monthlyResetAt"] as const) {
      if (current[k] !== undefined) next[k] = current[k];
    }
    await admin.from("profiles").update({ scan_limit_override: next }).eq("id", u.id);
  }
  revalidateAll();
}

export async function replyInquiry(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const reply = z.string().trim().min(1).max(5000).safeParse(formData.get("reply"));
  if (!id.success || !reply.success) return;
  const admin = createAdminClient();
  await admin
    .from("inquiries")
    .update({ admin_reply: reply.data, status: "answered", replied_at: new Date().toISOString() })
    .eq("id", id.data);
  revalidateAll();
}
