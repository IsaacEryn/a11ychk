import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireScanOwner } from "@/lib/apiAuth";
import { rescanPage } from "@/lib/scan/runScan";

export const maxDuration = 300;

const BodySchema = z.object({ pageId: z.string().uuid() });

/**
 * 실패한 단일 페이지 재검사 — 성공 시 보고서 전체가 재집계된다.
 * 기존 스캔의 일부 복구이므로 검사 한도를 차감하지 않는다.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  // 소유자 확인 (RLS + 명시 재확인)
  const scan = await requireScanOwner(supabase, id, user.id);
  if (!scan) {
    return NextResponse.json({ error: "검사를 찾을 수 없습니다." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  // 동기 실행 (단일 페이지 ~10-30초) — 완료 후 클라이언트가 새로고침
  const result = await rescanPage(id, parsed.data.pageId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }
  return NextResponse.json({ ok: true });
}
