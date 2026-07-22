import "server-only";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** 초대 코드 형식 — /join/[code] 라우트와 공유 */
export const REFERRAL_CODE_PATTERN = /^[a-z0-9]{8}$/;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** 8자 [a-z0-9] 무작위 코드 (36^8 ≈ 2.8×10^12 — 열거 무의미) */
export function generateReferralCode(): string {
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/**
 * 사용자의 초대 코드 조회 — 없으면 생성(lazy). 마이페이지 접근 시 호출.
 * unique 충돌(23505)은 재생성으로 흡수, 컬럼 부재(마이그레이션 전) 등 실패는 null.
 */
export async function ensureReferralCode(admin: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data, error } = await admin.from("profiles").select("referral_code").eq("id", userId).single();
    if (error) return null; // 컬럼 부재(0024 미적용) 포함 — 기능만 조용히 비활성
    const existing = (data as { referral_code?: unknown } | null)?.referral_code;
    if (typeof existing === "string" && existing) return existing;

    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateReferralCode();
      const { error: updateError } = await admin
        .from("profiles")
        .update({ referral_code: code })
        .eq("id", userId)
        .is("referral_code", null); // 동시 생성 레이스 — 먼저 쓴 쪽 유지
      if (!updateError) {
        // 레이스로 내 update가 0행이었을 수 있으니 재조회로 확정
        const { data: after } = await admin.from("profiles").select("referral_code").eq("id", userId).single();
        const final = (after as { referral_code?: unknown } | null)?.referral_code;
        if (typeof final === "string" && final) return final;
      }
      // 23505(다른 사용자와 코드 충돌) — 새 코드로 재시도
    }
    return null;
  } catch {
    return null;
  }
}
