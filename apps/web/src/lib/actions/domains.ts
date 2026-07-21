"use server";

import { resolveTxt } from "node:dns/promises";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { guardedFetch } from "@a11ychk/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVerifiedDomainLimit } from "@/lib/quota";
import { setupCloudflareTxt } from "@/lib/cloudflare";
import { scanUrlMatchesHost } from "@/lib/host";
import { requireUser, revalidateLocalized, type SaveState } from "./shared";

// ─────────────── 도메인 ───────────────
const HostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/, "올바른 도메인 형식이 아닙니다.");

/** 도메인 추가 — useActionState 시그니처. error: "invalid" | "duplicate" | "failed" */
export async function addDomain(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const { supabase, user } = await requireUser();
  const raw = String(formData.get("hostname") ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const parsed = HostnameSchema.safeParse(raw);
  if (!parsed.success) return { error: "invalid" };
  const { error } = await supabase.from("domains").insert({ user_id: user.id, hostname: parsed.data });
  if (error) return { error: error.code === "23505" ? "duplicate" : "failed" };
  revalidateLocalized("/dashboard");
  return { ok: true };
}

export async function deleteDomain(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  await supabase.from("domains").delete().eq("id", id.data).eq("user_id", user.id);
  revalidateLocalized("/dashboard");
}

/**
 * 도메인 정기 자동 스캔 켜기/끄기.
 * domains에는 UPDATE RLS 정책이 없어 사용자 클라이언트로는 갱신되지 않으므로,
 * 소유자(user_id) 필터를 명시한 admin 클라이언트로 갱신한다(verifyDomain과 동일 패턴).
 */
export async function toggleAutoScan(formData: FormData): Promise<void> {
  const { user } = await requireUser();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const enabled = formData.get("enabled") === "true";
  if (!id.success) return;
  await createAdminClient().from("domains").update({ auto_scan: !enabled }).eq("id", id.data).eq("user_id", user.id);
  revalidateLocalized("/dashboard");
}

/** 정기 스캔 회귀 알림 이메일 켜기/끄기 (domains.notify — migration 0013) */
export async function toggleNotify(formData: FormData): Promise<void> {
  const { user } = await requireUser();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const enabled = formData.get("enabled") === "true";
  if (!id.success) return;
  await createAdminClient().from("domains").update({ notify: !enabled }).eq("id", id.data).eq("user_id", user.id);
  revalidateLocalized("/dashboard");
}

/** 정기 검사 주기 설정 (domains.scan_frequency — migration 0021). useActionState 시그니처 */
export async function setScanFrequency(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const { user } = await requireUser();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const freq = z.enum(["daily", "weekly", "monthly"]).safeParse(formData.get("frequency"));
  if (!id.success || !freq.success) return { error: "invalid" };
  // domains에는 UPDATE RLS 정책이 없어 admin 클라이언트로 갱신(소유자 필터 명시)
  const { error } = await createAdminClient()
    .from("domains")
    .update({ scan_frequency: freq.data })
    .eq("id", id.data)
    .eq("user_id", user.id);
  if (error) return { error: "failed" };
  revalidateLocalized("/dashboard");
  return { ok: true };
}

/**
 * 공개 보고서 지정 — 단일 컨트롤로 공개 여부·디렉터리 등재·배지가 가리킬 보고서를 함께 정한다.
 * value: "off"(비공개) | "latest"(최신 검사 자동) | <scanId>(특정 보고서 고정).
 * 소유 확인된 도메인만 공개 가능. 특정 scan은 소유자·done·같은 호스트인지 검증한다.
 * (domains.public_listed 0018 + public_scan_id 0022)
 */
export async function setPublicReport(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const { user } = await requireUser();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const value = String(formData.get("value") ?? "");
  if (!id.success) return { error: "invalid" };

  const admin = createAdminClient();
  const { data: domain } = await admin
    .from("domains")
    .select("verified, hostname")
    .eq("id", id.data)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!domain) return { error: "invalid" }; // 타인 도메인/부재

  // 0022(public_scan_id) 적용 확정 — 폴백 없이 직접 갱신, 실패는 결과로 반환
  const applyUpdate = async (fields: { public_listed: boolean; listed_at: string | null; public_scan_id: string | null }) => {
    const { error } = await admin.from("domains").update(fields).eq("id", id.data).eq("user_id", user.id);
    return !error;
  };

  // 비공개 — 등재 해제 + **이 도메인 검사들의 공유 토큰 철회**.
  // /site·배지가 자동 발급한 토큰이 남아 있으면 "비공개"가 실효되지 않으므로(과거 링크 계속 유효),
  // 호스트가 일치하는 완료 검사의 share_token을 모두 무효화한다. 보고서 개별 공유가 필요하면
  // 소유자가 보고서 페이지에서 다시 켤 수 있다(새 토큰 발급).
  if (value === "off") {
    if (!(await applyUpdate({ public_listed: false, listed_at: null, public_scan_id: null }))) return { error: "failed" };
    const apex = (domain.hostname as string).toLowerCase().replace(/^www\./, "");
    const { data: tokenScans } = await admin
      .from("scans")
      .select("id, root_url")
      .eq("user_id", user.id)
      .not("share_token", "is", null)
      .ilike("root_url", `%${apex}%`)
      .limit(200);
    const revokeIds = (tokenScans ?? [])
      .filter((s) => scanUrlMatchesHost(s.root_url as string, domain.hostname as string))
      .map((s) => s.id as string);
    if (revokeIds.length > 0) {
      await admin.from("scans").update({ share_token: null }).in("id", revokeIds);
    }
    revalidateLocalized("/dashboard", "/directory");
    return { ok: true };
  }

  if (!domain.verified) return { error: "invalid" }; // 미확인 도메인은 공개 불가

  // 특정 보고서 고정 — 소유자·done·같은 호스트 검증(무효면 최신 자동으로 처리)
  let publicScanId: string | null = null;
  if (value !== "latest" && z.string().uuid().safeParse(value).success) {
    const { data: scan } = await admin
      .from("scans")
      .select("id, root_url")
      .eq("id", value)
      .eq("user_id", user.id)
      .eq("status", "done")
      .maybeSingle();
    if (scan && scanUrlMatchesHost(scan.root_url as string, domain.hostname as string)) {
      publicScanId = scan.id as string;
    }
  }

  if (!(await applyUpdate({ public_listed: true, listed_at: new Date().toISOString(), public_scan_id: publicScanId }))) return { error: "failed" };
  revalidateLocalized("/dashboard", "/directory");
  return { ok: true };
}

/**
 * 소유 확인 결과 상태 (useActionState용). UI가 next-intl로 문구를 번역해 표시한다.
 * - verified: 확인 성공  - failed: 세 방법 모두 확인 수단을 찾지 못함(예: DNS 전파 전)
 * - limit: 등급별 소유 확인 도메인 수 초과  - error: 잘못된 요청/도메인 없음
 */
export interface VerifyDomainState {
  status?: "verified" | "failed" | "limit" | "error";
  method?: "dns_txt" | "meta_tag" | "html_file";
  /** limit 상태에서 표시할 현재 한도 */
  limit?: number;
}

/**
 * 현재 사용자가 새 도메인을 소유 확인할 수 있는지 — 이미 확인된 도메인 수 < 등급 한도.
 * @returns 초과 시 { limit } (차단), 여유 있으면 null
 */
async function checkVerifyCapacity(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ limit: number } | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("scan_limit_override")
    .eq("id", userId)
    .single();
  const limit = getVerifiedDomainLimit(profile?.scan_limit_override);
  const { count } = await supabase
    .from("domains")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("verified", true);
  return (count ?? 0) >= limit ? { limit } : null;
}

/** DNS TXT(_a11ychk.호스트)·메타태그·.well-known 파일로 소유 확인. useActionState 시그니처. */
export async function verifyDomain(_prev: VerifyDomainState, formData: FormData): Promise<VerifyDomainState> {
  const { supabase, user } = await requireUser();
  const idParsed = z.string().uuid().safeParse(formData.get("id"));
  if (!idParsed.success) return { status: "error" };

  const { data: domain } = await supabase
    .from("domains")
    .select("id, hostname, verify_token, verified")
    .eq("id", idParsed.data)
    .eq("user_id", user.id)
    .single();
  if (!domain) return { status: "error" };
  if (domain.verified) return { status: "verified" };

  // 등급별 소유 확인 도메인 수 한도 검사
  const over = await checkVerifyCapacity(supabase, user.id);
  if (over) return { status: "limit", limit: over.limit };

  const method = await detectVerification(domain.hostname, domain.verify_token);
  if (!method) return { status: "failed" };

  // verified 갱신은 service role로 (domains에 UPDATE RLS 없음, 소유자 필터 명시)
  await createAdminClient().from("domains").update({ verified: true, verify_method: method }).eq("id", domain.id);
  revalidateLocalized("/dashboard", "/scan");
  return { status: "verified", method };
}

/** 3중 폴백(DNS TXT → 메타태그 → .well-known 파일)으로 소유 확인 수단을 탐지. 없으면 null */
async function detectVerification(
  hostname: string,
  token: string,
): Promise<"dns_txt" | "meta_tag" | "html_file" | null> {
  // 1) DNS TXT
  try {
    const records = await resolveTxt(`_a11ychk.${hostname}`);
    if (records.some((chunks) => chunks.join("").trim() === token)) return "dns_txt";
  } catch {
    // 레코드 없음 — 다음 방법으로
  }

  // 2) 메타태그 (홈페이지 <head>)
  try {
    const res = await guardedFetch(`https://${hostname}/`);
    if (res.ok) {
      const html = (await res.text()).slice(0, 500_000);
      // 토큰을 RegExp에 보간하지 않는다(정규식 주입·ReDoS 방지) — 태그만 정규식, 토큰은 문자열 비교
      const metaRe = /<meta\b[^>]*>/gi;
      for (const m of html.match(metaRe) ?? []) {
        if (m.toLowerCase().includes("a11ychk-verify") && m.includes(token)) return "meta_tag";
      }
    }
  } catch {
    // 접속 실패 — 다음 방법으로
  }

  // 3) HTML 파일 (.well-known/a11ychk-verify.txt)
  try {
    const res = await guardedFetch(`https://${hostname}/.well-known/a11ychk-verify.txt`);
    // 일부 서버는 404 본문에도 200을 주므로 content-type도 함께 본다
    const ct = res.headers.get("content-type") ?? "";
    if (res.ok && !ct.includes("html")) {
      const body = (await res.text()).slice(0, 1_000).trim();
      if (body === token) return "html_file";
    }
  } catch {
    // 접속 실패 — 미확인 유지
  }
  return null;
}

/**
 * Cloudflare 자동 설정 결과 상태 (useActionState용).
 * - verified: TXT 생성 후 즉시 확인까지 완료
 * - done: TXT 레코드는 생성했으나 아직 전파 전 → 잠시 후 "소유 확인" 필요
 * - zone_not_found: 토큰으로 이 도메인의 존을 찾지 못함  - auth_error: 토큰 무효/권한 부족
 * - api_error / invalid / limit / error
 */
export interface CloudflareState {
  status?: "verified" | "done" | "zone_not_found" | "auth_error" | "api_error" | "invalid" | "limit" | "error";
  limit?: number;
}

/**
 * Cloudflare API 토큰으로 소유 확인용 TXT 레코드를 자동 생성하고, 가능하면 즉시 확인까지 처리.
 * 토큰은 저장하지 않고 이 요청에서만 사용한다(cloudflare.ts). useActionState 시그니처.
 */
export async function setupCloudflareDns(_prev: CloudflareState, formData: FormData): Promise<CloudflareState> {
  const { supabase, user } = await requireUser();
  const idParsed = z.string().uuid().safeParse(formData.get("id"));
  const token = String(formData.get("cfToken") ?? "").trim();
  // Cloudflare API 토큰은 보통 40자. 형식만 느슨히 검증(값은 로깅하지 않음)
  if (!idParsed.success || token.length < 20 || token.length > 200) return { status: "invalid" };

  const { data: domain } = await supabase
    .from("domains")
    .select("id, hostname, verify_token, verified")
    .eq("id", idParsed.data)
    .eq("user_id", user.id)
    .single();
  if (!domain) return { status: "error" };
  if (domain.verified) return { status: "verified" };

  // 자동 설정 후 곧바로 확인까지 이어지므로, 확인 한도를 미리 검사해 헛수고를 막는다
  const over = await checkVerifyCapacity(supabase, user.id);
  if (over) return { status: "limit", limit: over.limit };

  const recordName = `_a11ychk.${domain.hostname}`;
  const result = await setupCloudflareTxt(token, domain.hostname, recordName, domain.verify_token);
  if (result.status !== "ok") return { status: result.status };

  // 레코드 생성 직후 1회 확인 시도 — 전파 전이면 실패할 수 있어 done으로 안내
  try {
    const records = await resolveTxt(recordName);
    if (records.some((chunks) => chunks.join("").trim() === domain.verify_token)) {
      await createAdminClient().from("domains").update({ verified: true, verify_method: "dns_txt" }).eq("id", domain.id);
      revalidateLocalized("/dashboard", "/scan");
      return { status: "verified" };
    }
  } catch {
    // 전파 전 — done으로 안내
  }
  return { status: "done" };
}
