import { NextResponse } from "next/server";
import { z } from "zod";
import { AXE_VERSION, aggregateScan, assertHttpUrl, type PageScanResult } from "@a11ychk/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkQuota, getResets, resolveLimits } from "@/lib/quota";
import { getPlansActive } from "@/lib/appSettings";

export const maxDuration = 60;

const NodeSchema = z.object({
  selector: z.string().max(2000),
  html: z.string().max(2000),
  failureSummary: z.string().max(2000).default(""),
});
const FindingSchema = z.object({
  ruleId: z.string().max(200),
  impact: z.enum(["critical", "serious", "moderate", "minor"]),
  tags: z.array(z.string().max(80)).max(50).default([]),
  helpUrl: z.string().max(500).default(""),
  nodes: z.array(NodeSchema).max(50),
});
const PageSchema = z.object({
  url: z.string().min(1).max(2000),
  violations: z.array(FindingSchema).max(300),
  passes: z.array(z.string().max(200)).max(300),
  incomplete: z.array(z.string().max(200)).max(300),
  scannedAt: z.string().max(40),
});
const BodySchema = z.object({
  page: PageSchema,
  manual: z.array(z.string().max(20)).max(60).optional(),
  /** WCAG-EM: 이 페이지가 다단계 프로세스의 한 단계인지 표시 */
  sampleType: z.enum(["structured", "random", "process"]).optional(),
});

/** 크롬 확장에서 이미 실행한 단일 페이지 검사 결과를 사용자 계정에 저장 */
export async function POST(request: Request) {
  // 1) Bearer 토큰(확장이 보낸 Supabase 액세스 토큰) 검증
  const authz = request.headers.get("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  if (!token) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const admin = createAdminClient();
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) {
    return NextResponse.json({ error: "세션이 만료되었습니다. 웹에서 다시 연결해 주세요." }, { status: 401 });
  }
  const user = userData.user;

  // 2) 입력 검증
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "잘못된 검사 데이터입니다." }, { status: 400 });

  let url: URL;
  try {
    url = assertHttpUrl(parsed.data.page.url);
  } catch {
    return NextResponse.json({ error: "검사 대상 URL이 올바르지 않습니다." }, { status: 400 });
  }

  // 3) 계정 상태·한도 확인 (확장 검사도 동일 정책 적용)
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
    const label = { daily: "일간", weekly: "주간", monthly: "월간" }[quota.exceeded!];
    return NextResponse.json({ error: `${label} 검사 한도를 모두 사용했습니다.` }, { status: 429 });
  }

  // 4) 저장 — 확장 검사는 이미 완료된 단일 페이지이므로 done 상태로 기록
  const page = parsed.data.page as PageScanResult;
  const summary = aggregateScan([page], AXE_VERSION);
  const nowIso = new Date().toISOString();

  const { data: scan, error: scanErr } = await admin
    .from("scans")
    .insert({
      user_id: user.id,
      root_url: url.toString(),
      status: "done",
      page_limit: 1,
      summary,
      created_at: nowIso,
      started_at: nowIso,
      finished_at: nowIso,
    })
    .select("id")
    .single();
  if (scanErr || !scan) return NextResponse.json({ error: "저장에 실패했습니다." }, { status: 500 });

  const counts: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of page.violations) counts[v.impact] = (counts[v.impact] ?? 0) + v.nodes.length;

  const { data: pageRow } = await admin
    .from("scan_pages")
    .insert({
      scan_id: scan.id,
      url: page.url,
      status: "done",
      sample_type: parsed.data.sampleType ?? "structured",
      violation_counts: counts,
      passes: page.passes,
      incomplete: page.incomplete,
      scanned_at: page.scannedAt,
    })
    .select("id")
    .single();

  if (pageRow && page.violations.length > 0) {
    const findingRows = page.violations.flatMap((v) =>
      v.nodes.map((n) => ({
        scan_page_id: pageRow.id,
        rule_id: v.ruleId,
        impact: v.impact,
        tags: v.tags,
        help_url: v.helpUrl,
        selector: n.selector,
        html_snippet: n.html,
        failure_summary: n.failureSummary,
      })),
    );
    await admin.from("findings").insert(findingRows);
  }

  return NextResponse.json({ id: scan.id }, { status: 201 });
}
