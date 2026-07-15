import { NextResponse } from "next/server";
import { z } from "zod";
import { UrlGuardError, assertPublicHttpUrl, checkBotAccess } from "@a11ychk/core";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const BodySchema = z.object({ url: z.string().min(1).max(2000) });

/** 봇 차단 검증 — 자동 검사 가능 여부와 차단 방식을 진단 (로그인 필요, 검사 한도 미차감) */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

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
