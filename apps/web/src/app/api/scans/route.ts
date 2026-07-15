import { NextResponse, after } from "next/server";
import { z } from "zod";
import { UrlGuardError, assertPublicHttpUrl, type EvaluationScope } from "@a11ychk/core";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkQuota, getResets, getSampleSize, resolveLimits } from "@/lib/quota";
import { getPlansActive } from "@/lib/appSettings";
import { runScan } from "@/lib/scan/runScan";

// Vercel Fluid Compute — after() 콜백(스캔 실행)까지 포함한 최대 실행 시간
export const maxDuration = 300;

/** 한국 기본 접근성 지원 기준 (WCAG-EM Step 1.c 프리셋) */
const DEFAULT_BASELINE = [
  "NVDA + Chrome (Windows)",
  "VoiceOver + Safari (macOS/iOS)",
  "센스리더 + Chrome (Windows)",
  "TalkBack + Chrome (Android)",
];

const CreateScanSchema = z.object({
  url: z.string().min(1).max(2000),
  scope: z
    .object({
      conformanceTarget: z.enum(["A", "AA", "AAA"]).optional(),
      accessibilitySupportBaseline: z.array(z.string().max(120)).max(20).optional(),
      includePatterns: z.array(z.string().max(300)).max(30).optional(),
      excludePatterns: z.array(z.string().max(300)).max(30).optional(),
      notes: z.string().max(2000).optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  // 1) 인증
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  // 2) 입력 검증
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }
  const parsed = CreateScanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "검사할 URL을 입력해 주세요." }, { status: 400 });
  }

  // 3) SSRF 가드 (형식 + DNS 검증)
  let url: URL;
  try {
    url = await assertPublicHttpUrl(parsed.data.url);
  } catch (e) {
    const message = e instanceof UrlGuardError ? e.message : "URL을 확인할 수 없습니다.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const admin = createAdminClient();

  // 4) 사용자 상태·한도 확인
  const { data: profile } = await admin
    .from("profiles")
    .select("blocked, scan_limit_override")
    .eq("id", user.id)
    .single();
  if (!profile || profile.blocked) {
    return NextResponse.json({ error: "검사를 실행할 수 없는 계정입니다." }, { status: 403 });
  }

  const plansActive = await getPlansActive(admin);
  const quota = await checkQuota(
    admin,
    user.id,
    resolveLimits(profile.scan_limit_override, plansActive),
    getResets(profile.scan_limit_override),
  );
  if (!quota.ok) {
    const windowLabel = { daily: "일간", weekly: "주간", monthly: "월간" }[quota.exceeded!];
    return NextResponse.json(
      {
        error: `${windowLabel} 검사 한도(${quota.limits[quota.exceeded!]}회)를 모두 사용했습니다.`,
        quota,
      },
      { status: 429 },
    );
  }

  // 5) 동시 실행 제한 — 사용자당 1건
  const { count: runningCount } = await admin
    .from("scans")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .in("status", ["queued", "running"]);
  if ((runningCount ?? 0) > 0) {
    return NextResponse.json({ error: "이미 진행 중인 검사가 있습니다. 완료 후 다시 시도해 주세요." }, { status: 409 });
  }

  // 6) 도메인 연결 + 요금제·소유확인 기반 표본 크기
  const { data: domain } = await admin
    .from("domains")
    .select("id, verified")
    .eq("user_id", user.id)
    .eq("hostname", url.hostname)
    .maybeSingle();

  const pageLimit = getSampleSize({
    override: profile.scan_limit_override,
    verified: domain?.verified ?? false,
    plansActive,
  });

  // WCAG-EM Step 1 평가 범위 (미입력 시 합리적 기본값)
  const scope: EvaluationScope = {
    conformanceTarget: parsed.data.scope?.conformanceTarget ?? "AA",
    accessibilitySupportBaseline:
      parsed.data.scope?.accessibilitySupportBaseline?.length
        ? parsed.data.scope.accessibilitySupportBaseline
        : DEFAULT_BASELINE,
    includePatterns: parsed.data.scope?.includePatterns,
    excludePatterns: parsed.data.scope?.excludePatterns,
    notes: parsed.data.scope?.notes,
  };

  const { data: scan, error: insertError } = await admin
    .from("scans")
    .insert({
      user_id: user.id,
      domain_id: domain?.id ?? null,
      root_url: url.toString(),
      status: "queued",
      page_limit: pageLimit,
      scope,
    })
    .select("id")
    .single();
  if (insertError || !scan) {
    return NextResponse.json({ error: "검사 생성에 실패했습니다." }, { status: 500 });
  }

  // 7) 응답 반환 후 백그라운드에서 스캔 실행
  after(() => runScan(scan.id));

  return NextResponse.json({ id: scan.id }, { status: 202 });
}
