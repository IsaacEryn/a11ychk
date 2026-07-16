import { NextResponse } from "next/server";
import { z } from "zod";
import { UrlGuardError, assertPublicHttpUrl, checkBotAccess } from "@a11ychk/core";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const BodySchema = z.object({ url: z.string().min(1).max(2000) });

// 사용자별 시간당 진단 횟수 제한 (서버가 임의 공개 URL을 fetch하는 증폭 방지).
// 인스턴스 메모리 기반 best-effort — 서버리스 특성상 완전하진 않지만 버스트를 차단한다.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 3600_000;
const rateBuckets = new Map<string, number[]>();

function checkRate(userId: string): boolean {
  const now = Date.now();
  const stamps = (rateBuckets.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (stamps.length >= RATE_LIMIT) {
    rateBuckets.set(userId, stamps);
    return false;
  }
  stamps.push(now);
  rateBuckets.set(userId, stamps);
  return true;
}

/** 봇 차단 검증 — 자동 검사 가능 여부와 차단 방식을 진단 (로그인 필요, 검사 한도 미차감) */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!checkRate(user.id)) {
    return NextResponse.json({ error: "진단 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "확인할 URL을 입력해 주세요." }, { status: 400 });

  try {
    const url = await assertPublicHttpUrl(parsed.data.url);
    const result = await checkBotAccess(url.toString());
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof UrlGuardError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json({ error: "진단에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
