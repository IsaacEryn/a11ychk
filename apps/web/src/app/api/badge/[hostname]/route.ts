import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDomainPublicScan } from "@/lib/host";
import { gradeOf, gradeColor } from "@/lib/badgeGrade";
import type { ScanSummary } from "@a11ychk/core";

export const runtime = "nodejs";
// 배지는 공개 임베드용 — 5분 캐시
export const revalidate = 300;

function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function badgeSvg(label: string, value: string, color: string): string {
  // 좌: 라벨(먹색), 우: 값(색상). 스크린리더용 title 포함.
  const labelW = 78;
  const valueW = Math.max(46, value.length * 9 + 20);
  const total = labelW + valueW;
  const title = `${label}: ${value}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${esc(title)}">
  <title>${esc(title)}</title>
  <rect width="${labelW}" height="20" fill="#1c2422"/>
  <rect x="${labelW}" width="${valueW}" height="20" fill="${color}"/>
  <g fill="#fff" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
    <text x="${labelW / 2}" y="14">${esc(label)}</text>
    <text x="${labelW + valueW / 2}" y="14" font-weight="bold">${esc(value)}</text>
  </g>
</svg>`;
}

function svgResponse(svg: string): NextResponse {
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
    },
  });
}

/**
 * 공개 접근성 배지. 소유 확인된 도메인의 최신 완료 검사 준수율을 SVG로 제공.
 * 임베드: <img src="https://a11ychk.com/api/badge/example.com" alt="접근성 점검 준수율">
 */
export async function GET(_req: Request, { params }: { params: Promise<{ hostname: string }> }) {
  const { hostname: raw } = await params;
  const hostname = decodeURIComponent(raw).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  const admin = createAdminClient();
  // 소유 확인된 도메인만 배지 제공 (사칭·오용 방지)
  const { data: domain } = await admin
    .from("domains")
    .select("id, user_id, verified, public_scan_id")
    .eq("hostname", hostname)
    .eq("verified", true)
    .maybeSingle();

  if (!domain) {
    return svgResponse(badgeSvg("A11Y Check", "N/A", "#9e9e9e"));
  }

  // 공개 지정 검사(있으면) 또는 www/apex 무관 최신 완료 검사
  const scan = await getDomainPublicScan<{ summary: unknown; root_url: string | null }>(
    admin,
    { user_id: domain.user_id as string, hostname, public_scan_id: domain.public_scan_id as string | null },
    "summary, root_url",
  );

  const summary = scan?.summary as ScanSummary | null;
  if (!summary) {
    return svgResponse(badgeSvg("A11Y Check", "N/A", "#9e9e9e"));
  }

  const rate = summary.complianceRate;
  // 자동 점검 준수율 — 배지·디렉터리·보고서 요약 공통 밴딩
  return svgResponse(badgeSvg("A11Y Check", `${rate}%`, gradeColor(gradeOf(rate))));
}
