"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resolveTxt } from "node:dns/promises";
import { z } from "zod";
import { guardedFetch } from "@a11ychk/core";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
export async function updateNickname(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const parsed = z.string().trim().min(1).max(30).safeParse(formData.get("nickname"));
  if (!parsed.success) return;
  await supabase.from("profiles").update({ nickname: parsed.data }).eq("id", user.id);
  revalidateAll();
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
