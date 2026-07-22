import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { signReportToken } from "@/lib/reportToken";
import { launchBrowser } from "@/lib/scan/browser";
import { apiError, resolveApiLocale } from "@/lib/apiError";

export const maxDuration = 300;

const IdSchema = z.string().uuid();

/**
 * 보고서 PDF 생성.
 * 소유자 확인 후, 단기 서명 토큰을 붙인 보고서 URL을 헤드리스 크로미엄으로 열어
 * A4 PDF로 렌더링해 내려준다.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ?lang= 우선, 없으면 Accept-Language 협상 — 에러·보고서 렌더 언어 공통
  const locale = resolveApiLocale(request);
  if (!IdSchema.safeParse(id).success) {
    return apiError(locale, "invalidRequest", 400);
  }

  // 소유자(또는 관리자) 확인 — RLS가 적용된 사용자 클라이언트로 조회
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return apiError(locale, "loginRequired", 401);
  }
  const { data: scan } = await supabase.from("scans").select("id, status, root_url").eq("id", id).maybeSingle();
  if (!scan) {
    return apiError(locale, "reportNotFound", 404);
  }
  if (scan.status !== "done") {
    return apiError(locale, "pdfNotDone", 409);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const token = signReportToken(id);
  // 출력 범위(view)·로케일을 보고서 렌더 URL로 패스스루 — 웹 화면과 동일한 필터로 PDF 생성
  const sp = new URL(request.url).searchParams;
  const viewRaw = sp.get("view");
  const view = viewRaw === "done" || viewRaw === "issues" || viewRaw === "auto" ? viewRaw : null;
  const lang = locale;
  const compareRaw = sp.get("compare");
  const compare = compareRaw && IdSchema.safeParse(compareRaw).success ? compareRaw : null;
  const stdRaw = sp.get("std");
  const std = stdRaw === "wcag" || stdRaw === "kwcag" ? stdRaw : null;
  const prefRaw = sp.get("pref");
  const pref = prefRaw === "wcag" || prefRaw === "kwcag" ? prefRaw : null;
  const reportUrl = `${siteUrl}/${lang}/scans/${id}/report?token=${encodeURIComponent(token)}${view ? `&view=${view}` : ""}${compare ? `&compare=${compare}` : ""}${std ? `&std=${std}` : ""}${pref ? `&pref=${pref}` : ""}`;

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto(reportUrl, { waitUntil: "networkidle", timeout: 60_000 });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#888;text-align:center;">A11y Check · a11ychk.com — <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
    const hostname = new URL(scan.root_url).hostname;
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="a11ychk-report-${hostname}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return apiError(locale, "pdfFailed", 500);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
