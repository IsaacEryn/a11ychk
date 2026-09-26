import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 사용자가 보고 있는 로케일을 profiles.locale(0001, 기본 'ko')에 기록한다 — 사용자가 화면에 없을 때
 * 보내는 메일(정기 검사 회귀 알림)의 언어를 정하는 근거. 대시보드를 볼 때와
 * 정기 검사·알림 설정 액션에서 부른다. best-effort: 실패해도 원래 동작은 계속된다.
 */
export async function rememberLocale(admin: SupabaseClient, userId: string, locale: string): Promise<void> {
  if (locale !== "ko" && locale !== "en") return;
  await admin
    .from("profiles")
    .update({ locale })
    .eq("id", userId)
    .neq("locale", locale)
    .then(
      () => undefined,
      () => undefined,
    );
}

/** 저장된 로케일 해석 — 모르는 값은 ko(서비스 1차 언어) */
export function mailLocale(value: unknown): "ko" | "en" {
  return value === "en" ? "en" : "ko";
}
