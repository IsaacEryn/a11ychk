"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeScores, type ScanSummary, type WcagMatrixRow, type WcagOutcome } from "@a11ychk/core";
import { guardedFetch } from "@a11ychk/core";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireScanOwner } from "@/lib/apiAuth";
import { isImpersonatingNickname } from "@/lib/nickname";
import { MAX_PAGES_PER_SCAN, PLAN_IDS } from "@/lib/quota";
import { setPlansActive } from "@/lib/appSettings";
import { logAdminAction } from "@/lib/logs";

/** 전 경로 캐시 무효화 — 인증 상태처럼 모든 페이지에 영향이 있을 때만 사용 */
function revalidateAll() {
  revalidatePath("/", "layout");
}

/** 영향받은 경로만 무효화 (양 로케일). 예: revalidateLocalized("/dashboard") */
function revalidateLocalized(...paths: string[]) {
  for (const path of paths) {
    revalidatePath(`/ko${path}`);
    revalidatePath(`/en${path}`);
  }
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
  revalidateLocalized("/dashboard");
}

export async function deleteDomain(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  await supabase.from("domains").delete().eq("id", id.data).eq("user_id", user.id);
  revalidateLocalized("/dashboard");
}

/** 도메인 정기 자동 스캔 켜기/끄기 */
export async function toggleAutoScan(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const enabled = formData.get("enabled") === "true";
  if (!id.success) return;
  await supabase.from("domains").update({ auto_scan: !enabled }).eq("id", id.data).eq("user_id", user.id);
  revalidateLocalized("/dashboard");
}

/** 정기 스캔 회귀 알림 이메일 켜기/끄기 (domains.notify — migration 0013) */
export async function toggleNotify(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const enabled = formData.get("enabled") === "true";
  if (!id.success) return;
  await supabase.from("domains").update({ notify: !enabled }).eq("id", id.data).eq("user_id", user.id);
  revalidateLocalized("/dashboard");
}

/**
 * 공개 배지 발행 + 디렉터리 등재 opt-in 토글 (domains.public_listed — migration 0018).
 * 소유 확인된 도메인만 등재 가능. 끄면 즉시 공개 목록·배지 링크에서 회수한다.
 */
export async function togglePublicListing(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const enabled = formData.get("enabled") === "true";
  if (!id.success) return;
  // 소유 확인(verified) 도메인만 공개 등재 허용
  const { data: domain } = await supabase
    .from("domains")
    .select("verified")
    .eq("id", id.data)
    .eq("user_id", user.id)
    .maybeSingle();
  const next = !enabled;
  if (next && !domain?.verified) return; // 미확인 도메인은 공개 등재 불가
  await supabase
    .from("domains")
    .update({ public_listed: next, listed_at: next ? new Date().toISOString() : null })
    .eq("id", id.data)
    .eq("user_id", user.id);
  revalidateLocalized("/dashboard", "/directory");
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
        // 토큰을 RegExp에 보간하지 않는다(정규식 주입·ReDoS 방지) —
        // 메타태그 패턴만 정규식으로 찾고 토큰은 문자열 비교로 확인
        const metaRe = /<meta\b[^>]*>/gi;
        for (const m of html.match(metaRe) ?? []) {
          const tag = m.toLowerCase();
          if (tag.includes("a11ychk-verify") && m.includes(domain.verify_token)) {
            method = "meta_tag";
            break;
          }
        }
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
  revalidateLocalized("/dashboard", "/scan");
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

export async function createInquiry(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const parsed = InquirySchema.safeParse({
    type: formData.get("type"),
    title: formData.get("title"),
    body: formData.get("body"),
  });
  if (!parsed.success) return;
  // 레이트리밋 — 사용자당 최근 10분 내 5건 초과 시 무시 (스팸·테이블 팽창 방지)
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await supabase
    .from("inquiries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);
  if ((count ?? 0) >= 5) return;
  await supabase.from("inquiries").insert({ user_id: user.id, ...parsed.data });
  revalidateLocalized("/contact", "/admin/inquiries");
}

// ─────────────── 보고서 워크벤치 (점검자 판정·메타) ───────────────
/** 공통 저장 결과 (useActionState 피드백용) */
export interface SaveState {
  ok?: boolean;
  /** "invalid" | "forbidden" | "failed" */
  error?: string;
}

const ReviewSchema = z.object({
  scanId: z.string().uuid(),
  standard: z.enum(["wcag", "kwcag"]),
  itemId: z.string().min(1).max(20),
  outcome: z.enum(["passed", "failed", "cannotTell", "notPresent", "notChecked"]),
  note: z.string().max(5000).default(""),
});

/** 점검자 판정 저장 (upsert). 빈 outcome 전달 시 판정 삭제 */
/**
 * 점검자 판정 변경 후 summary.scores(수동·통합 준수율)만 다시 계산해 저장.
 * 자동 판정 매트릭스는 그대로이므로 전체 재집계 없이 점수만 갱신한다.
 */
async function refreshScores(supabase: SupabaseClient, scanId: string): Promise<void> {
  const { data: scan } = await supabase.from("scans").select("summary").eq("id", scanId).maybeSingle();
  const summary = scan?.summary as ScanSummary | null;
  if (!summary?.wcagMatrix) return;

  const { data: reviews } = await supabase
    .from("scan_reviews")
    .select("standard, item_id, outcome")
    .eq("scan_id", scanId);
  const wcagReviews: Record<string, WcagOutcome> = {};
  for (const r of reviews ?? []) {
    if (r.standard === "wcag") wcagReviews[r.item_id as string] = r.outcome as WcagOutcome;
  }

  const scores = computeScores(summary.wcagMatrix as WcagMatrixRow[], wcagReviews);
  // scores 키만 원자 갱신(jsonb_set RPC — migration 0011) — 동시 재집계와의
  // read-merge-write 덮어쓰기 방지. RPC 미적용 시 기존 전체 갱신으로 폴백.
  const { error: rpcErr } = await supabase.rpc("update_scan_summary_scores", {
    p_scan_id: scanId,
    p_scores: scores,
  });
  if (rpcErr) {
    await supabase.from("scans").update({ summary: { ...summary, scores } }).eq("id", scanId);
  }
}

export async function saveReview(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const { supabase, user } = await requireUser();

  const scanId = z.string().uuid().safeParse(formData.get("scanId"));
  if (!scanId.success) return { error: "invalid" };
  // 소유자 검증 (RLS로도 막히지만 명시적으로)
  const scan = await requireScanOwner(supabase, scanId.data, user.id);
  if (!scan) return { error: "forbidden" };

  // 판정 해제 (자동 판정으로 되돌리기)
  if (formData.get("outcome") === "") {
    const standard = z.enum(["wcag", "kwcag"]).safeParse(formData.get("standard"));
    const itemId = z.string().min(1).max(20).safeParse(formData.get("itemId"));
    if (!standard.success || !itemId.success) return { error: "invalid" };
    const { error } = await supabase
      .from("scan_reviews")
      .delete()
      .eq("scan_id", scanId.data)
      .eq("standard", standard.data)
      .eq("item_id", itemId.data);
    if (error) return { error: "failed" };
    await refreshScores(supabase, scanId.data);
    revalidateLocalized(`/scans/${scanId.data}`, `/scans/${scanId.data}/report`);
    return { ok: true };
  }

  const parsed = ReviewSchema.safeParse({
    scanId: formData.get("scanId"),
    standard: formData.get("standard"),
    itemId: formData.get("itemId"),
    outcome: formData.get("outcome"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { error: "invalid" };

  // 관련 페이지(선택) — 어떤 페이지에서 확인된 사항인지 기록 (migration 0010)
  // 폼 조작으로 임의 문자열·실재하지 않는 페이지가 들어오면 준수율 계산이 왜곡되므로
  // 해당 스캔의 실제 페이지 URL 집합으로 필터하고 중복을 제거한다
  const rawPages = formData.getAll("pages").filter((p): p is string => typeof p === "string" && p.length > 0);
  let pages: string[] = [];
  if (rawPages.length > 0) {
    const { data: scanPages } = await supabase
      .from("scan_pages")
      .select("url")
      .eq("scan_id", parsed.data.scanId);
    const valid = new Set((scanPages ?? []).map((r) => r.url as string));
    pages = [...new Set(rawPages)].filter((u) => valid.has(u));
  }
  const row: Record<string, unknown> = {
    scan_id: parsed.data.scanId,
    standard: parsed.data.standard,
    item_id: parsed.data.itemId,
    outcome: parsed.data.outcome,
    note: parsed.data.note,
    pages: pages.length > 0 ? pages.slice(0, 50) : null,
    updated_at: new Date().toISOString(),
  };
  let { error } = await supabase.from("scan_reviews").upsert(row, { onConflict: "scan_id,standard,item_id" });
  if (error && /pages/.test(error.message)) {
    // pages 컬럼 미적용(migration 0010 전) — 컬럼 없이 재시도
    delete row.pages;
    ({ error } = await supabase.from("scan_reviews").upsert(row, { onConflict: "scan_id,standard,item_id" }));
  }
  if (error) return { error: "failed" };
  await refreshScores(supabase, parsed.data.scanId);
  revalidateLocalized(`/scans/${scanId.data}`, `/scans/${scanId.data}/report`);
  return { ok: true };
}

const ReportMetaSchema = z.object({
  siteName: z.string().max(200).optional(),
  organization: z.string().max(200).optional(),
  evaluatorName: z.string().max(100).optional(),
  title: z.string().max(300).optional(),
  executiveSummary: z.string().max(10000).optional(),
});

/** 보고서 메타 정보 저장 (scans.report_meta) */
export async function saveReportMeta(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const { supabase, user } = await requireUser();

  const scanId = z.string().uuid().safeParse(formData.get("scanId"));
  if (!scanId.success) return { error: "invalid" };
  const scan = await requireScanOwner(supabase, scanId.data, user.id);
  if (!scan) return { error: "forbidden" };

  const parsed = ReportMetaSchema.safeParse({
    siteName: str(formData.get("siteName")),
    organization: str(formData.get("organization")),
    evaluatorName: str(formData.get("evaluatorName")),
    title: str(formData.get("title")),
    executiveSummary: str(formData.get("executiveSummary")),
  });
  if (!parsed.success) return { error: "invalid" };

  // service role로 갱신 (scans는 클라이언트 update 정책이 없음 — 서버에서 소유 검증 후)
  const admin = createAdminClient();
  const { error } = await admin.from("scans").update({ report_meta: parsed.data }).eq("id", scanId.data);
  if (error) return { error: "failed" };
  revalidateLocalized(`/scans/${scanId.data}`, `/scans/${scanId.data}/report`);
  return { ok: true };
}

/** 공유 링크 토글 결과 — token이 있으면 공유 중 */
export interface ShareState {
  ok?: boolean;
  token?: string | null;
  /** "invalid" | "forbidden" | "failed" */
  error?: string;
}

/**
 * 보고서 읽기 전용 공유 링크 켜기/끄기 (scans.share_token — migration 0012).
 * 켜면 64자 hex 토큰 발급, 끄면 null — 기존 링크는 즉시 무효.
 */
export async function toggleShareLink(_prev: ShareState, formData: FormData): Promise<ShareState> {
  const { supabase, user } = await requireUser();

  const scanId = z.string().uuid().safeParse(formData.get("scanId"));
  if (!scanId.success) return { error: "invalid" };
  const scan = await requireScanOwner(supabase, scanId.data, user.id);
  if (!scan) return { error: "forbidden" };

  const admin = createAdminClient();
  // share_token 조회는 별도 best-effort — 0012 미적용이면 아래 update에서 failed로 귀결
  const { data: cur } = await admin
    .from("scans")
    .select("share_token")
    .eq("id", scanId.data)
    .maybeSingle()
    .then((r) => r, () => ({ data: null }));
  const next = cur?.share_token ? null : crypto.randomBytes(32).toString("hex");
  const { error } = await admin.from("scans").update({ share_token: next }).eq("id", scanId.data);
  if (error) return { error: "failed" }; // 0012 미적용 포함
  revalidateLocalized(`/scans/${scanId.data}`, `/scans/${scanId.data}/report`);
  return { ok: true, token: next };
}

function str(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}

// ─────────────── 관리자 ───────────────
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
