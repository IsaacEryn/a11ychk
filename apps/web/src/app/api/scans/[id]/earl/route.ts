import { NextResponse } from "next/server";
import { z } from "zod";
import { WCAG_BY_ID, type EvaluationScope, type ScanSummary, type WcagOutcome } from "@a11ychk/core";
import { createClient } from "@/lib/supabase/server";

/**
 * WCAG-EM Step 5.e — 기계 판독 가능 평가 결과 (EARL 정렬 JSON).
 * 소유자(또는 관리자)만 접근. 자동 평가 부분의 SC별 결과를 EARL 어휘로 제공한다.
 */
const IdSchema = z.string().uuid();

const EARL_OUTCOME: Record<WcagOutcome, string> = {
  passed: "earl:passed",
  failed: "earl:failed",
  cannotTell: "earl:cantTell",
  notChecked: "earl:untested",
  notPresent: "earl:inapplicable",
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  // RLS로 소유자/관리자만 조회됨
  const { data: scan } = await supabase
    .from("scans")
    .select("id, root_url, status, summary, scope, finished_at, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!scan || scan.status !== "done" || !scan.summary) {
    return NextResponse.json({ error: "완료된 보고서를 찾을 수 없습니다." }, { status: 404 });
  }

  const summary = scan.summary as ScanSummary;
  const scope = (scan.scope ?? null) as EvaluationScope | null;

  const earl = {
    "@context": "https://www.w3.org/ns/earl",
    "@type": "earl:Software",
    assertedBy: { "@type": "earl:Assertor", name: "A11Y Check", homepage: "https://a11ychk.com" },
    subject: {
      "@type": "earl:TestSubject",
      url: scan.root_url,
      scope: scope ?? { conformanceTarget: "AA" },
    },
    evaluation: {
      standard: "WCAG 2.2",
      methodology: "WCAG-EM 1.0 (automated portion)",
      date: scan.finished_at ?? scan.created_at,
      engine: `${summary.engine.name} ${summary.engine.axeVersion}`,
      conformanceTarget: scope?.conformanceTarget ?? "AA",
      sample: summary.sample ?? null,
      note: "이 결과는 자동 평가로 산출된 WCAG-EM의 자동화 가능 부분입니다. 완전한 적합성 판정에는 전문가의 수동 평가가 필요합니다.",
    },
    assertions: summary.wcagMatrix.map((row) => {
      const c = WCAG_BY_ID.get(row.scId);
      return {
        "@type": "earl:Assertion",
        test: { sc: row.scId, name: c?.name.en ?? row.scId, level: c?.level },
        result: {
          "@type": "earl:TestResult",
          outcome: EARL_OUTCOME[row.outcome],
          violationCount: row.violationCount,
          rules: row.ruleIds,
        },
      };
    }),
  };

  return NextResponse.json(earl, {
    headers: {
      "Content-Disposition": `inline; filename="a11ychk-earl-${new URL(scan.root_url).hostname}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
