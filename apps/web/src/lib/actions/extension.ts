"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "./shared";

/**
 * 확장 전용 세션용 1회용 토큰 해시 발급.
 * 연결 페이지가 웹 세션의 access token을 그대로 넘기던 방식은 refresh token을 줄 수 없어
 * (웹과 확장이 같은 토큰을 회전시키면 서로를 무효화한다) 1시간마다 재연결해야 했다.
 * 대신 매직링크 토큰 해시를 발급해 확장이 Supabase Auth에서 직접 자기 세션으로 교환하게 한다 —
 * 확장은 독립된 refresh token을 갖고, 연결 해제 시 그 세션만 철회된다.
 * 해시는 1회용·단기이며 로그인한 본인에게만, 우리 오리진의 확장에만 postMessage로 전달된다.
 */
export async function issueExtensionToken(): Promise<{ tokenHash: string } | { error: "noEmail" | "failed" }> {
  const { user } = await requireUser();
  if (!user.email) return { error: "noEmail" };
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return { error: "failed" };
  return { tokenHash };
}
