"use server";

import { z } from "zod";
import { loadEntitlement } from "@/lib/entitlements";
import { requireUser, revalidateLocalized, type SaveState } from "./shared";

/** 검사 폼 옵션 세트 (프리셋 options jsonb). CreateScanSchema.scope와 정합 */
const PresetOptionsSchema = z.object({
  url: z.string().max(2000).optional(),
  mode: z.enum(["auto", "manual"]).optional(),
  // AAA는 카탈로그에 없어 AA로 검사된다 — 예전 클라이언트가 보내도 AA로 저장
  conformanceTarget: z
    .enum(["A", "AA", "AAA"])
    .transform((v) => (v === "AAA" ? "AA" : v))
    .optional(),
  pageCount: z.number().int().min(1).max(30).optional(),
  manualPages: z.array(z.string().max(2000)).max(30).optional(),
  excludePatterns: z.array(z.string().max(300)).max(30).optional(),
  notes: z.string().max(2000).optional(),
});

export type PresetOptions = z.infer<typeof PresetOptionsSchema>;
export interface ScanPreset {
  id: string;
  name: string;
  options: PresetOptions;
}

/** 요청 사용자의 프리셋 목록 (없거나 테이블 미적용 환경은 빈 배열) */
export async function listPresets(): Promise<ScanPreset[]> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("scan_presets")
    .select("id, name, options")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    options: (PresetOptionsSchema.safeParse(r.options).data ?? {}) as PresetOptions,
  }));
}

/**
 * 프리셋 저장 (이름 기준 upsert). 신규 이름이면 등급별 개수 제한을 검사한다.
 * useActionState 시그니처. error: "invalid" | "limit" | "failed"
 */
export async function savePreset(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const { supabase, user } = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 60) return { error: "invalid" };

  let parsedOptions: PresetOptions;
  try {
    parsedOptions = PresetOptionsSchema.parse(JSON.parse(String(formData.get("options") ?? "{}")));
  } catch {
    return { error: "invalid" };
  }

  // 등급별 개수 제한 — 신규 이름일 때만 검사(기존 이름 덮어쓰기는 개수 증가 아님)
  const { limits } = await loadEntitlement(supabase, user.id);
  const limit = limits.presets;
  const { data: existing } = await supabase.from("scan_presets").select("name").eq("user_id", user.id);
  const names = new Set((existing ?? []).map((r) => r.name as string));
  if (!names.has(name) && names.size >= limit) return { error: "limit" };

  const { error } = await supabase
    .from("scan_presets")
    .upsert({ user_id: user.id, name, options: parsedOptions }, { onConflict: "user_id,name" });
  if (error) return { error: "failed" };
  revalidateLocalized("/scan");
  return { ok: true };
}

/** 프리셋 삭제 (RLS로 소유자만) */
export async function deletePreset(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  await supabase.from("scan_presets").delete().eq("id", id.data).eq("user_id", user.id);
  revalidateLocalized("/scan");
}
