import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireScanOwner } from "@/lib/apiAuth";
import { apiError, resolveApiLocale } from "@/lib/apiError";
import { rescanPage } from "@/lib/scan/runScan";

export const maxDuration = 300;

const BodySchema = z.object({ pageId: z.string().uuid() });

/**
 * 실패한 단일 페이지 재검사 — 성공 시 보고서 전체가 재집계된다.
 * 기존 스캔의 일부 복구이므로 검사 한도를 차감하지 않는다.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = resolveApiLocale(request);
  if (!z.string().uuid().safeParse(id).success) {
    return apiError(locale, "invalidRequest", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError(locale, "loginRequired", 401);

  // 소유자 확인 (RLS + 명시 재확인)
  const scan = await requireScanOwner(supabase, id, user.id);
  if (!scan) {
    return apiError(locale, "scanNotFound", 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(locale, "invalidBody", 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return apiError(locale, "invalidRequest", 400);

  // 동기 실행 (단일 페이지 ~10-30초) — 완료 후 클라이언트가 새로고침
  const result = await rescanPage(id, parsed.data.pageId);
  if (!result.ok) {
    // error에 실패 사유 상세(ko)를 유지하고 code로 일반 번역 폴백을 제공
    return NextResponse.json({ error: result.error, code: "rescanFailed" }, { status: 422 });
  }
  // findings·summary가 바뀌면 scan.finished_at도 갱신되어(reaggregate) 보고서
  // 대량 데이터 캐시 키가 자동으로 달라진다 — 별도 무효화 불필요.
  return NextResponse.json({ ok: true });
}
