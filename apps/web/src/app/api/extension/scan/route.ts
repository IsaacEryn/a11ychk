import { NextResponse } from "next/server";
import { z } from "zod";
import { AXE_VERSION, aggregateScan, assertHttpUrl, categorizePage, type PageScanResult } from "@a11ychk/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkExtUsage, getExtDailyLimit } from "@/lib/quota";
import { reaggregate } from "@/lib/scan/runScan";

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

  // 3) 계정 상태·확장 한도 확인 — 웹 검사 한도와 분리된 확장 전용 한도.
  //    사용량은 검사 시점(/api/extension/usage)에 소비하므로 여기서는 초과 여부만 검증.
  const { data: profile } = await admin
    .from("profiles")
    .select("blocked, scan_limit_override")
    .eq("id", user.id)
    .single();
  if (!profile || profile.blocked) {
    return NextResponse.json({ error: "검사를 실행할 수 없는 계정입니다." }, { status: 403 });
  }
  const extLimit = getExtDailyLimit(profile.scan_limit_override);
  const usage = await checkExtUsage(admin, user.id, extLimit, false);
  if (!usage.ok) {
    return NextResponse.json({ error: `오늘의 확장 검사 한도(${usage.limit}회)를 모두 사용했습니다.` }, { status: 429 });
  }

  const page = parsed.data.page as PageScanResult;
  const counts: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of page.violations) counts[v.impact] = (counts[v.impact] ?? 0) + v.nodes.length;
  const nowIso = new Date().toISOString();

  // via 컬럼(migration 0009) 미적용 환경에서도 저장이 깨지지 않도록 조건부 사용
  const { error: viaProbe } = await admin.from("scan_pages").select("via").limit(1);
  const viaField = viaProbe ? {} : { via: "extension" };

  const findingRowsFor = (pageRowId: string) =>
    page.violations.flatMap((v) =>
      v.nodes.map((n) => ({
        scan_page_id: pageRowId,
        rule_id: v.ruleId,
        impact: v.impact,
        tags: v.tags,
        help_url: v.helpUrl,
        selector: n.selector,
        html_snippet: n.html,
        failure_summary: n.failureSummary,
      })),
    );

  // 4-a) 같은 사이트(호스트)의 기존 완료 보고서가 있으면 그 보고서에 페이지를 취합
  const { data: candidates } = await admin
    .from("scans")
    .select("id, root_url, created_at")
    .eq("user_id", user.id)
    .eq("status", "done")
    .gte("created_at", new Date(Date.now() - 30 * 24 * 3600_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(20);
  const target = (candidates ?? []).find((s) => {
    try {
      return new URL(s.root_url).hostname === url.hostname;
    } catch {
      return false;
    }
  });

  if (target) {
    // 같은 URL 페이지가 이미 있으면 결과 교체, 없으면 새 페이지 추가
    const { data: existing } = await admin
      .from("scan_pages")
      .select("id")
      .eq("scan_id", target.id)
      .eq("url", page.url)
      .maybeSingle();

    let pageRowId: string | null = null;
    if (existing) {
      await admin.from("findings").delete().eq("scan_page_id", existing.id);
      await admin
        .from("scan_pages")
        .update({
          status: "done",
          error: null,
          ...viaField,
          sample_type: parsed.data.sampleType ?? "structured",
          violation_counts: counts,
          passes: page.passes,
          incomplete: page.incomplete,
          scanned_at: page.scannedAt,
        })
        .eq("id", existing.id);
      pageRowId = existing.id;
    } else {
      const { data: inserted } = await admin
        .from("scan_pages")
        .insert({
          scan_id: target.id,
          url: page.url,
          status: "done",
          ...viaField,
          category: categorizePage(page.url, false),
          sample_type: parsed.data.sampleType ?? "structured",
          violation_counts: counts,
          passes: page.passes,
          incomplete: page.incomplete,
          scanned_at: page.scannedAt,
        })
        .select("id")
        .single();
      pageRowId = inserted?.id ?? null;
    }
    if (!pageRowId) return NextResponse.json({ error: "저장에 실패했습니다." }, { status: 500 });
    if (page.violations.length > 0) await admin.from("findings").insert(findingRowsFor(pageRowId));

    // 보고서 요약 재집계 (확장 페이지 포함)
    await reaggregate(admin, target.id);
    return NextResponse.json({ id: target.id, merged: true, rootUrl: target.root_url }, { status: 201 });
  }

  // 4-b) 기존 보고서 없음 — 단일 페이지 보고서 생성 (확장 검사는 이미 완료 상태)
  const summary = aggregateScan([page], AXE_VERSION);
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

  const { data: pageRow } = await admin
    .from("scan_pages")
    .insert({
      scan_id: scan.id,
      url: page.url,
      status: "done",
      ...viaField,
      category: categorizePage(page.url, true),
      sample_type: parsed.data.sampleType ?? "structured",
      violation_counts: counts,
      passes: page.passes,
      incomplete: page.incomplete,
      scanned_at: page.scannedAt,
    })
    .select("id")
    .single();

  if (pageRow && page.violations.length > 0) {
    await admin.from("findings").insert(findingRowsFor(pageRow.id));
  }

  return NextResponse.json({ id: scan.id, merged: false }, { status: 201 });
}
