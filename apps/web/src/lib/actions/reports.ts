"use server";

import crypto from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeScores, type ScanSummary, type WcagMatrixRow, type WcagOutcome } from "@a11ychk/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireScanOwner } from "@/lib/apiAuth";
import { requireUser, revalidateLocalized, str, type SaveState } from "./shared";

// ─────────────── 보고서 워크벤치 (점검자 판정·메타) ───────────────

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
  const kwcagReviews: Record<string, WcagOutcome> = {};
  for (const r of reviews ?? []) {
    (r.standard === "wcag" ? wcagReviews : kwcagReviews)[r.item_id as string] = r.outcome as WcagOutcome;
  }

  // kwcag 판정은 computeScores가 대응 SC로 파생 소비 (wcag 직접 판정 우선)
  const scores = computeScores(summary.wcagMatrix as WcagMatrixRow[], wcagReviews, kwcagReviews);
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

/** report_meta에 patch를 병합 저장 — 기존 필드(공유 보기 설정 등)를 보존한다(읽기-수정-쓰기) */
async function mergeReportMeta(
  admin: ReturnType<typeof createAdminClient>,
  scanId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data } = await admin.from("scans").select("report_meta").eq("id", scanId).maybeSingle();
  const current = (data?.report_meta ?? {}) as Record<string, unknown>;
  const { error } = await admin
    .from("scans")
    .update({ report_meta: { ...current, ...patch } })
    .eq("id", scanId);
  return !error;
}

/** 보고서 메타 정보 저장 (scans.report_meta) — 공유 보기 설정(publicView/Std)은 보존 */
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
  const ok = await mergeReportMeta(createAdminClient(), scanId.data, parsed.data);
  if (!ok) return { error: "failed" };
  revalidateLocalized(`/scans/${scanId.data}`, `/scans/${scanId.data}/report`);
  return { ok: true };
}

/**
 * 공유 보기 표시 설정 저장 (report_meta.publicView/publicStd).
 * 비소유자(공유 링크·배지)로 보고서를 볼 때 이 표시 모드(출력 범위·표준)로 고정 노출된다.
 */
export async function savePublicView(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const { supabase, user } = await requireUser();
  const scanId = z.string().uuid().safeParse(formData.get("scanId"));
  if (!scanId.success) return { error: "invalid" };
  const scan = await requireScanOwner(supabase, scanId.data, user.id);
  if (!scan) return { error: "forbidden" };

  const view = z.enum(["all", "auto", "done", "issues"]).safeParse(formData.get("view"));
  const std = z.enum(["both", "wcag", "kwcag"]).safeParse(formData.get("std"));
  if (!view.success || !std.success) return { error: "invalid" };

  const ok = await mergeReportMeta(createAdminClient(), scanId.data, {
    publicView: view.data,
    publicStd: std.data,
  });
  if (!ok) return { error: "failed" };
  revalidateLocalized(`/scans/${scanId.data}/report`);
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
