import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TEASER_GLOBAL_DAILY_CAP, TEASER_GLOBAL_KEY } from "@/lib/teaser";

interface TeaserRow {
  hostname: string;
  rate: number;
  rule_count: number;
  node_count: number;
  locale: string;
  created_at: string;
}

const DAY = 24 * 3600_000;

/** n일 전 ISO 시각 — 컴포넌트 본문 밖에서 Date.now 호출 (react-hooks/purity) */
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString();
}

/** 오늘(UTC) 날짜 — teaser_usage 카운터의 day 컬럼과 동일 기준 */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 관리자 맛보기 검사 통계 — 도메인별 수요·평균 준수율·볼륨.
 * teaser_scans는 service role 전용(RLS 정책 0) — 개인정보 없음(호스트명·수치만).
 * migration 0026 미적용 환경은 빈 상태로 표시된다.
 */
export default async function AdminTeaserPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin.teaser");
  const format = await getFormatter();

  const admin = createAdminClient();
  // 볼륨 카운트 — '오늘'은 teaser_usage 카운터와 일치하도록 UTC 일 시작 기준
  const todayStart = todayUtc();
  const countSince = (since: string) =>
    admin
      .from("teaser_scans")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since)
      .then(
        (r) => r.count ?? 0,
        () => 0,
      );
  const [todayCount, weekCount, monthCount, totalCount] = await Promise.all([
    countSince(todayStart),
    countSince(daysAgoIso(7)),
    countSince(daysAgoIso(30)),
    admin
      .from("teaser_scans")
      .select("id", { count: "exact", head: true })
      .then(
        (r) => r.count ?? 0,
        () => 0,
      ),
  ]);

  // 오늘 전역 캡 사용량 (429 포함 실제 소비 기준 — teaser_usage sentinel 행)
  const { data: globalRow } = await admin
    .from("teaser_usage")
    .select("count")
    .eq("ip_hash", TEASER_GLOBAL_KEY)
    .eq("day", todayStart)
    .maybeSingle()
    .then(
      (r) => r,
      () => ({ data: null }),
    );
  const globalUsed = globalRow?.count ?? 0;

  // 최근 30일 상세 행 — 평균·도메인 집계·최근 목록의 원천 (전역 캡 100/일 → 최대 ~3000행)
  const { data: rows } = await admin
    .from("teaser_scans")
    .select("hostname, rate, rule_count, node_count, locale, created_at")
    .gte("created_at", daysAgoIso(30))
    .order("created_at", { ascending: false })
    .limit(3200)
    .then(
      (r) => r,
      () => ({ data: null }),
    );
  const recent30 = (rows ?? []) as TeaserRow[];

  const avgRate30 =
    recent30.length > 0 ? Math.round((recent30.reduce((s, r) => s + Number(r.rate), 0) / recent30.length) * 10) / 10 : null;

  // 도메인별 집계 (검사 수 내림차순 상위 30)
  const byDomain = new Map<string, { count: number; rateSum: number; last: string }>();
  for (const r of recent30) {
    const d = byDomain.get(r.hostname) ?? { count: 0, rateSum: 0, last: r.created_at };
    d.count += 1;
    d.rateSum += Number(r.rate);
    if (r.created_at > d.last) d.last = r.created_at;
    byDomain.set(r.hostname, d);
  }
  const domains = [...byDomain.entries()]
    .map(([hostname, d]) => ({ hostname, count: d.count, avg: Math.round((d.rateSum / d.count) * 10) / 10, last: d.last }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  const cards: { label: string; value: string }[] = [
    { label: t("cards.today"), value: String(todayCount) },
    { label: t("cards.week"), value: String(weekCount) },
    { label: t("cards.month"), value: String(monthCount) },
    { label: t("cards.total"), value: String(totalCount) },
    { label: t("cards.globalCap"), value: `${globalUsed} / ${TEASER_GLOBAL_DAILY_CAP}` },
    { label: t("cards.avgRate"), value: avgRate30 === null ? "—" : `${avgRate30}%` },
  ];

  return (
    <section className="mt-8">
      <h2 className="font-display text-2xl font-bold">{t("title")}</h2>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{t("intro")}</p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] p-4">
            <dt className="text-xs font-semibold text-[var(--color-ink-faint)]">{c.label}</dt>
            <dd className="font-display mt-1 text-2xl font-extrabold tabular-nums">{c.value}</dd>
          </div>
        ))}
      </dl>

      {recent30.length === 0 ? (
        <p className="mt-6 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-[var(--color-ink-faint)]">
          {t("empty")}
        </p>
      ) : (
        <>
          {/* 도메인별 수요 — 어떤 사이트가 맛보기를 쓰는지 (최근 30일) */}
          <h3 className="font-display mt-8 text-xl font-bold">{t("domainsTitle")}</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
              <caption className="sr-only">{t("domainsTitle")}</caption>
              <thead>
                <tr className="border-b-[1.5px] border-[var(--color-ink)] text-left">
                  <th scope="col" className="py-2 pr-3 font-bold">{t("colDomain")}</th>
                  <th scope="col" className="py-2 pr-3 font-bold">{t("colCount")}</th>
                  <th scope="col" className="py-2 pr-3 font-bold">{t("colAvgRate")}</th>
                  <th scope="col" className="py-2 font-bold">{t("colLast")}</th>
                </tr>
              </thead>
              <tbody>
                {domains.map((d) => (
                  <tr key={d.hostname} className="border-b border-dashed border-[var(--color-line)]">
                    <td className="py-2 pr-3 font-semibold">{d.hostname}</td>
                    <td className="py-2 pr-3 tabular-nums">{d.count}</td>
                    <td className="py-2 pr-3 tabular-nums">{d.avg}%</td>
                    <td className="py-2 text-[var(--color-ink-soft)]">
                      {format.dateTime(new Date(d.last), { dateStyle: "medium", timeStyle: "short" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 최근 검사 목록 (최신 50건) */}
          <h3 className="font-display mt-8 text-xl font-bold">{t("recentTitle")}</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
              <caption className="sr-only">{t("recentTitle")}</caption>
              <thead>
                <tr className="border-b-[1.5px] border-[var(--color-ink)] text-left">
                  <th scope="col" className="py-2 pr-3 font-bold">{t("colTime")}</th>
                  <th scope="col" className="py-2 pr-3 font-bold">{t("colDomain")}</th>
                  <th scope="col" className="py-2 pr-3 font-bold">{t("colRate")}</th>
                  <th scope="col" className="py-2 pr-3 font-bold">{t("colViolations")}</th>
                  <th scope="col" className="py-2 font-bold">{t("colLocale")}</th>
                </tr>
              </thead>
              <tbody>
                {recent30.slice(0, 50).map((r, i) => (
                  <tr key={`${r.created_at}-${i}`} className="border-b border-dashed border-[var(--color-line)]">
                    <td className="py-2 pr-3 text-[var(--color-ink-soft)]">
                      {format.dateTime(new Date(r.created_at), { dateStyle: "medium", timeStyle: "short" })}
                    </td>
                    <td className="py-2 pr-3 font-semibold">{r.hostname}</td>
                    <td className="py-2 pr-3 tabular-nums">{Number(r.rate)}%</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {t("violationsCell", { rules: r.rule_count, nodes: r.node_count })}
                    </td>
                    <td className="py-2 uppercase text-[var(--color-ink-faint)]">{r.locale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
