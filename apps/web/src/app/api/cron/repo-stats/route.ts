import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { collectImpactStats } from "@/lib/impactStats";
import { collectRepoStats } from "@/lib/repoStats";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { logAppError } from "@/lib/logs";

/**
 * GitHub 저장소 통계 수집 크론 (하루 1회).
 * 수집 로직은 lib/repoStats.collectRepoStats() 공유(관리자 수동 새로고침과 동일).
 *
 * 필요 환경변수:
 * - CRON_SECRET: Vercel Cron 인증
 * - GITHUB_STATS_TOKEN: 트래픽 API용 토큰(Administration read 또는 repo scope).
 *   없으면 트래픽은 건너뛰고 스타·포크만 기록한다.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let result;
  try {
    result = await collectRepoStats();
  } catch (e) {
    // Vercel 크론 재시도 정책상 200으로 보고하되, 무증상이 되지 않게 흔적은 남긴다
    await logAppError(createAdminClient(), `repo stats collect failed: ${String(e).slice(0, 300)}`, {
      path: "cron.repo-stats",
    });
    return NextResponse.json({ ok: false, reason: (e as Error).message });
  }

  // ── 월간 지표 스냅샷 메일 — 매월 1일(UTC) 발송. 메일 타임스탬프가 시점 기록이 된다.
  //    ?snapshot=1 로 강제 발송 가능 (CRON_SECRET 인증은 이미 통과한 상태)
  const force = new URL(request.url).searchParams.get("snapshot") === "1";
  let snapshot = false;
  if (force || new Date().getUTCDate() === 1) {
    try {
      snapshot = await sendMonthlySnapshot();
    } catch (e) {
      // 스냅샷 실패는 통계 수집에 영향 없음 — 매월 1회뿐이라 놓치면 복구 기회가 없어 기록
      await logAppError(createAdminClient(), `monthly snapshot failed: ${String(e).slice(0, 300)}`, {
        path: "cron.repo-stats",
      });
    }
  }

  return NextResponse.json({ ok: true, ...result, snapshot });
}

/** 월간 지표 스냅샷 — 임팩트 지표 + 가입자 수를 관리자 메일로 (미설정 시 no-op) */
async function sendMonthlySnapshot(): Promise<boolean> {
  const to = process.env.ADMIN_ALERT_EMAIL;
  const key = process.env.RESEND_API_KEY;
  if (!to || !key) return false;

  const stats = await collectImpactStats();
  const admin = createAdminClient();
  const { count: users } = await admin.from("profiles").select("id", { count: "exact", head: true });
  const { count: domains } = await admin.from("domains").select("id", { count: "exact", head: true });

  const month = new Date().toISOString().slice(0, 7);
  const line = (k: string, v: string | number) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#47524e">${k}</td><td style="padding:4px 0;font-weight:700;text-align:right">${v}</td></tr>`;
  const html = `
<div style="font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1c2422;font-size:14px;line-height:1.6">
  <p style="font-weight:700;margin:0 0 12px">${month} 지표 스냅샷 (발송 시각 기준 누적)</p>
  <table style="border-collapse:collapse">
    ${line("완료 검사", stats.scans)}
    ${line("검사 페이지", stats.pages)}
    ${line("발견 위반 요소", stats.findings)}
    ${line("검사 사이트(호스트)", stats.sites)}
    ${line("최근 30일 검사", stats.scans30d)}
    ${line("개선 확인 사이트", `${stats.improvedSites} (평균 +${stats.avgRateGain}%p)`)}
    ${line("공유 보고서", stats.sharedReports)}
    ${line("AI 수정 요청 다운로드", stats.aiFixDownloads)}
    ${line("가입 사용자", users ?? 0)}
    ${line("등록 도메인", domains ?? 0)}
    ${line("GitHub", stats.github ? `★${stats.github.stars} / fork ${stats.github.forks}` : "-")}
    ${line("저장소 트래픽(누적)", stats.traffic ? `view ${stats.traffic.views} / clone ${stats.traffic.clones}` : "-")}
  </table>
  <p style="margin:14px 0 0;font-size:12px;color:#5d6a66">이 메일은 매월 1일 자동 발송됩니다. 시점 기록으로 보관하세요. 공개 지표: https://www.a11ychk.com/ko/impact</p>
</div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: "A11y Check <noreply@a11ychk.com>",
      to,
      subject: `[A11y Check] 월간 지표 스냅샷 ${month}`,
      html,
    }),
  });
  return res.ok;
}
