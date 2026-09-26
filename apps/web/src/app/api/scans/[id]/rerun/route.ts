import { NextResponse, after } from "next/server";
import { z } from "zod";
import { UrlGuardError, assertPublicHttpUrl, type EvaluationScope } from "@a11ychk/core";
import { createClient } from "@/lib/supabase/server";
import { requireScanOwner } from "@/lib/apiAuth";
import { apiError, resolveApiLocale } from "@/lib/apiError";
import { createScanForUser } from "@/lib/scan/createScan";
import { drainQueue } from "@/lib/scan/drain";

export const maxDuration = 300;

const IdSchema = z.string().uuid();

/**
 * 동일 조건 재검사 — 기존 스캔의 대상 URL·평가 범위(직접 입력 표본 포함)·페이지 수를
 * 그대로 복사해 새 검사를 만든다. 한도·동시 실행 정책은 신규 검사와 동일하게 적용.
 * 점검자 판정은 이어받지 않는다 — 출처·판정 시점 표시와 사용자 선택 없이 옮기면 과거 판정이
 * 이번 검사의 판정처럼 보이고 새 자동 위반을 가린다(2026-09 다관점 검토). 별도 설계 과제.
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
  const original = await requireScanOwner<{
    id: string;
    user_id: string;
    root_url: string;
    scope: unknown;
    page_limit: number | null;
  }>(supabase, id, user.id, "id, user_id, root_url, scope, page_limit");
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
  // 예전 AAA 목표 검사도 AA로 — AAA 기준은 카탈로그에 없어 A+AA로 검사된다(신규 검사·프리셋과 같은 규칙)
  const normalizedScope: EvaluationScope =
    scope.conformanceTarget === "AAA" ? { ...scope, conformanceTarget: "AA" } : scope;

  // 원래 검사한 페이지 수 유지 — 지정하지 않으면 한도 최대치로 검사돼 "동일 조건"이 아니었다
  // (서버가 다시 사용자 한도로 클램프하므로 등급이 내려갔으면 줄어든다)
  const result = await createScanForUser(user.id, url, normalizedScope, {
    requestedPages: original.page_limit ?? undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code, params: result.params }, { status: result.status });
  }

  // 큐를 거쳐 실행 — 직접 runScan을 부르면 전역 동시 실행 상한(MAX_CONCURRENT_SCANS)
  // 밖에서 돌고, 드레이너가 같은 검사를 claim해 이중 실행될 수 있다.
  after(() => drainQueue());
  return NextResponse.json({ id: result.id }, { status: 202 });
}
