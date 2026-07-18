import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { collectImpactStats } from "@/lib/impactStats";

const REPO = "IsaacEryn/a11ychk";

interface TrafficPoint {
  timestamp: string;
  count: number;
  uniques: number;
}

/**
 * GitHub 저장소 통계 수집 크론 (하루 1회).
 * 트래픽 API(조회·클론)는 최근 14일만 제공하므로 매일 14일치를 date 기준
 * upsert해 히스토리를 무기한 축적한다. 스타·포크는 오늘 날짜 행에 스냅샷.
 *
 * 필요 환경변수:
 * - CRON_SECRET: Vercel Cron 인증 (기존과 동일)
 * - GITHUB_STATS_TOKEN: 트래픽 API용 토큰(저장소 push 권한 보유 계정의
 *   fine-grained PAT — Administration read 또는 classic repo scope).
 *   없으면 트래픽은 건너뛰고 스타·포크만 기록한다.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authz = request.headers.get("authorization");
  if (!secret || authz !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.GITHUB_STATS_TOKEN;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "a11ychk-stats",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };

  // date(UTC) → 일별 수치 병합
  const byDate = new Map<string, { views: number; unique_views: number; clones: number; unique_clones: number }>();
  const row = (date: string) => {
    const cur = byDate.get(date) ?? { views: 0, unique_views: 0, clones: 0, unique_clones: 0 };
    byDate.set(date, cur);
    return cur;
  };

  let trafficOk = false;
  if (token) {
    try {
      const [viewsRes, clonesRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${REPO}/traffic/views?per=day`, { headers, cache: "no-store" }),
        fetch(`https://api.github.com/repos/${REPO}/traffic/clones?per=day`, { headers, cache: "no-store" }),
      ]);
      if (viewsRes.ok) {
        const data = (await viewsRes.json()) as { views?: TrafficPoint[] };
        for (const p of data.views ?? []) {
          const r = row(p.timestamp.slice(0, 10));
          r.views = p.count;
          r.unique_views = p.uniques;
        }
        trafficOk = true;
      }
      if (clonesRes.ok) {
        const data = (await clonesRes.json()) as { clones?: TrafficPoint[] };
        for (const p of data.clones ?? []) {
          const r = row(p.timestamp.slice(0, 10));
          r.clones = p.count;
          r.unique_clones = p.uniques;
        }
        trafficOk = true;
      }
    } catch {
      // 트래픽 수집 실패 — 스타·포크 스냅샷은 계속 진행
    }
  }

  // 저장소 메타(공개 API) — 오늘 행에 스냅샷
  let stars: number | null = null;
  let forks: number | null = null;
  try {
    const repoRes = await fetch(`https://api.github.com/repos/${REPO}`, { headers, cache: "no-store" });
    if (repoRes.ok) {
      const repo = (await repoRes.json()) as { stargazers_count?: number; forks_count?: number };
      stars = repo.stargazers_count ?? null;
      forks = repo.forks_count ?? null;
    }
  } catch {
    // 무시
  }

  const today = new Date().toISOString().slice(0, 10);
  row(today); // 트래픽이 없어도 오늘 행은 생성 (스타·포크 스냅샷용)

  const rows = [...byDate.entries()].map(([date, v]) => ({
    date,
    ...v,
    ...(date === today ? { stars, forks } : {}),
    updated_at: new Date().toISOString(),
  }));

  const admin = createAdminClient();
  const { error } = await admin.from("repo_stats").upsert(rows, { onConflict: "date" });
  if (error) {
    // 마이그레이션 0007 미적용 등 — 크론 실패로 기록되지 않게 200으로 보고만
    return NextResponse.json({ ok: false, reason: error.message });
  }

  // ── 월간 지표 스냅샷 메일 — 매월 1일(UTC) 발송. 메일 타임스탬프가 실적 시점 증적이 된다.
  //    ?snapshot=1 로 강제 발송 가능 (CRON_SECRET 인증은 이미 통과한 상태)
  const force = new URL(request.url).searchParams.get("snapshot") === "1";
  let snapshot = false;
  if (force || new Date().getUTCDate() === 1) {
    try {
      snapshot = await sendMonthlySnapshot();
    } catch {
      // 스냅샷 실패는 통계 수집에 영향 없음
    }
  }

  return NextResponse.json({ ok: true, days: rows.length, traffic: trafficOk, stars, forks, snapshot });
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
  <p style="margin:14px 0 0;font-size:12px;color:#5d6a66">이 메일은 매월 1일 자동 발송됩니다. 공적조서 증적으로 보관하세요. 공개 지표: https://www.a11ychk.com/ko/impact</p>
</div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: "A11Y Check <noreply@a11ychk.com>",
      to,
      subject: `[A11Y Check] 월간 지표 스냅샷 ${month}`,
      html,
    }),
  });
  return res.ok;
}
