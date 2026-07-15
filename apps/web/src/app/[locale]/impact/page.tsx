import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { unstable_cache } from "next/cache";
import { Link } from "@/i18n/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "impact" });
  return { title: t("title"), description: t("desc") };
}

interface ImpactStats {
  scans: number;
  pages: number;
  findings: number;
  sites: number;
  scans30d: number;
  /** 2회 이상 검사한 사이트 중 위반이 줄거나 준수율이 오른 사이트 수 */
  improvedSites: number;
  /** 재검사 사이트 수 (개선 여부 무관) */
  rescannedSites: number;
  /** 개선 사이트들의 평균 준수율 상승(%p) */
  avgRateGain: number;
  github: { stars: number; forks: number } | null;
  computedAt: string;
}

/** 공개 임팩트 지표 — 1시간 캐시 (service role 사용, 사용자 데이터는 집계 수치만 노출) */
const getImpactStats = unstable_cache(
  async (): Promise<ImpactStats> => {
    const admin = createAdminClient();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

    const [scans, pages, findings, scans30d, scanRows] = await Promise.all([
      admin.from("scans").select("id", { count: "exact", head: true }).eq("status", "done"),
      admin.from("scan_pages").select("id", { count: "exact", head: true }).eq("status", "done"),
      admin.from("findings").select("id", { count: "exact", head: true }),
      admin
        .from("scans")
        .select("id", { count: "exact", head: true })
        .eq("status", "done")
        .gte("created_at", thirtyDaysAgo),
      admin
        .from("scans")
        .select("root_url, created_at, rate:summary->complianceRate, nodes:summary->totalViolationNodes")
        .eq("status", "done")
        .order("created_at", { ascending: true })
        .limit(5000),
    ]);

    // 사이트(호스트) 단위 집계 + 개선 확인 (같은 사이트의 첫 검사 vs 최신 검사)
    const byHost = new Map<string, { firstRate: number; firstNodes: number; lastRate: number; lastNodes: number; count: number }>();
    for (const s of scanRows.data ?? []) {
      let host: string;
      try {
        host = new URL(s.root_url as string).hostname;
      } catch {
        continue;
      }
      const rate = typeof s.rate === "number" ? s.rate : Number(s.rate ?? 0);
      const nodes = typeof s.nodes === "number" ? s.nodes : Number(s.nodes ?? 0);
      const cur = byHost.get(host);
      if (!cur) byHost.set(host, { firstRate: rate, firstNodes: nodes, lastRate: rate, lastNodes: nodes, count: 1 });
      else {
        cur.lastRate = rate;
        cur.lastNodes = nodes;
        cur.count += 1;
      }
    }
    let improvedSites = 0;
    let rescannedSites = 0;
    let rateGainSum = 0;
    for (const v of byHost.values()) {
      if (v.count < 2) continue;
      rescannedSites += 1;
      if (v.lastNodes < v.firstNodes || v.lastRate > v.firstRate) {
        improvedSites += 1;
        rateGainSum += Math.max(0, v.lastRate - v.firstRate);
      }
    }

    // 오픈소스 지표 (실패해도 페이지는 정상)
    let github: ImpactStats["github"] = null;
    try {
      const res = await fetch("https://api.github.com/repos/IsaacEryn/a11ychk", {
        headers: { accept: "application/vnd.github+json" },
        next: { revalidate: 3600 },
      });
      if (res.ok) {
        const repo = (await res.json()) as { stargazers_count?: number; forks_count?: number };
        github = { stars: repo.stargazers_count ?? 0, forks: repo.forks_count ?? 0 };
      }
    } catch {
      // GitHub API 실패 — 생략
    }

    return {
      scans: scans.count ?? 0,
      pages: pages.count ?? 0,
      findings: findings.count ?? 0,
      sites: byHost.size,
      scans30d: scans30d.count ?? 0,
      improvedSites,
      rescannedSites,
      avgRateGain: improvedSites === 0 ? 0 : Math.round((rateGainSum / improvedSites) * 10) / 10,
      github,
      computedAt: new Date().toISOString(),
    };
  },
  ["impact-stats"],
  { revalidate: 3600 },
);

export default async function ImpactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("impact");
  const format = await getFormatter();
  const stats = await getImpactStats();

  const n = (v: number) => format.number(v);

  const mainStats = [
    { label: t("stats.sites"), value: n(stats.sites) },
    { label: t("stats.scans"), value: n(stats.scans) },
    { label: t("stats.pages"), value: n(stats.pages) },
    { label: t("stats.findings"), value: n(stats.findings) },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <p className="text-sm font-bold uppercase tracking-widest text-[var(--color-seal)]">{t("eyebrow")}</p>
      <h1 className="font-display mt-1 text-3xl font-bold">{t("title")}</h1>
      <p className="mt-2 max-w-2xl leading-relaxed text-[var(--color-ink-soft)]">{t("desc")}</p>

      {/* 누적 지표 */}
      <dl className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {mainStats.map((s) => (
          <div key={s.label} className="doc-card p-5">
            <dt className="text-sm font-semibold text-[var(--color-ink-soft)]">{s.label}</dt>
            <dd className="font-display mt-1 text-4xl font-extrabold tabular-nums text-[var(--color-seal)]">{s.value}</dd>
          </div>
        ))}
      </dl>

      {/* 개선 확인 */}
      <section aria-labelledby="improve-heading" className="doc-card mt-6 p-6">
        <h2 id="improve-heading" className="font-display text-xl font-bold">
          {t("improve.title")}
        </h2>
        <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("improve.desc")}</p>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="border-l-[3px] border-[var(--color-seal)] pl-3">
            <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t("improve.rescanned")}</dt>
            <dd className="font-display text-3xl font-extrabold tabular-nums">{n(stats.rescannedSites)}</dd>
          </div>
          <div className="border-l-[3px] border-[var(--color-seal)] pl-3">
            <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t("improve.improved")}</dt>
            <dd className="font-display text-3xl font-extrabold tabular-nums text-[var(--color-seal)]">
              {n(stats.improvedSites)}
            </dd>
          </div>
          <div className="border-l-[3px] border-[var(--color-seal)] pl-3">
            <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t("improve.avgGain")}</dt>
            <dd className="font-display text-3xl font-extrabold tabular-nums">
              {stats.improvedSites > 0 ? `+${stats.avgRateGain}%p` : "—"}
            </dd>
          </div>
        </dl>
      </section>

      {/* 최근 30일 + 오픈소스 */}
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <section aria-labelledby="recent-heading" className="doc-card p-6">
          <h2 id="recent-heading" className="font-display text-xl font-bold">
            {t("recent.title")}
          </h2>
          <p className="font-display mt-2 text-4xl font-extrabold tabular-nums text-[var(--color-seal)]">
            {n(stats.scans30d)}
          </p>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{t("recent.unit")}</p>
        </section>
        <section aria-labelledby="oss-heading" className="doc-card p-6">
          <h2 id="oss-heading" className="font-display text-xl font-bold">
            {t("oss.title")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">{t("oss.desc")}</p>
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold">
            {stats.github && (
              <>
                <span>★ {n(stats.github.stars)} stars</span>
                <span>⑂ {n(stats.github.forks)} forks</span>
              </>
            )}
            <a
              href="https://github.com/IsaacEryn/a11ychk"
              className="text-[var(--color-seal)] underline underline-offset-4"
              rel="noopener"
            >
              {t("oss.link")}
            </a>
          </p>
        </section>
      </div>

      {/* 방법론 각주 + CTA */}
      <p className="mt-6 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        {t("note", { date: format.dateTime(new Date(stats.computedAt), { dateStyle: "medium", timeStyle: "short" }) })}
      </p>
      <p className="mt-6">
        <Link
          href="/scan"
          className="inline-block rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
        >
          {t("cta")}
        </Link>
      </p>
    </div>
  );
}
