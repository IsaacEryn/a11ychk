import { NextResponse, after } from "next/server";
import { z } from "zod";
import { UrlGuardError, assertPublicHttpUrl, type EvaluationScope } from "@a11ychk/core";
import { createClient } from "@/lib/supabase/server";
import { requireScanOwner } from "@/lib/apiAuth";
import { apiError, resolveApiLocale } from "@/lib/apiError";
import { createScanForUser } from "@/lib/scan/createScan";
import { runScan } from "@/lib/scan/runScan";

export const maxDuration = 300;

const IdSchema = z.string().uuid();

/**
 * 동일 조건 재검사 — 기존 스캔의 대상 URL과 평가 범위(직접 입력 표본 포함)를
 * 그대로 복사해 새 검사를 만든다. 한도·동시 실행 정책은 신규 검사와 동일하게 적용.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = resolveApiLocale(req);
  if (!IdSchema.safeParse(id).success) {
    return apiError(locale, "invalidRequest", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError(locale, "loginRequired", 401);

  // RLS로 본인 스캔만 조회됨 + 소유자 명시 확인 (관리자가 남의 스캔을 재실행해 한도를 쓰는 것 방지)
  const original = await requireScanOwner<{ id: string; user_id: string; root_url: string; scope: unknown }>(
    supabase, id, user.id, "id, user_id, root_url, scope",
  );
  if (!original) {
    return apiError(locale, "scanNotFound", 404);
  }

  let url: URL;
  try {
    url = await assertPublicHttpUrl(original.root_url);
  } catch (e) {
    // UrlGuardError.code → i18n 코드 (scans 라우트와 동일 매핑) — 클라이언트가 번역
    const code = e instanceof UrlGuardError ? `url_${e.code.replaceAll("-", "_")}` : "urlUnknown";
    const message = e instanceof UrlGuardError ? e.message : "대상 URL을 확인할 수 없습니다.";
    return NextResponse.json({ error: message, code }, { status: 400 });
  }

  const scope = (original.scope ?? { conformanceTarget: "AA", accessibilitySupportBaseline: [] }) as EvaluationScope;

  const result = await createScanForUser(user.id, url, scope);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code, params: result.params }, { status: result.status });
  }

  after(() => runScan(result.id));
  return NextResponse.json({ id: result.id }, { status: 202 });
}
