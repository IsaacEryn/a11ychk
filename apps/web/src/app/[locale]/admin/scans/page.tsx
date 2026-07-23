import { requireAdmin } from "@/lib/adminGuard";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { StatusBadge } from "@/components/StatusBadge";
import { AdminRetryForm } from "./AdminRetryForm";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.scans")} — ${t("title")}` };
}

const STATUSES = ["queued", "running", "done", "failed"] as const;
type ScanStatus = (typeof STATUSES)[number];
// teaser = 비로그인 맛보기(teaser_scans, 0026) — 회원 검사와 별도 테이블이라 병합 표시
const TYPES = ["manual", "auto", "scheduled", "teaser"] as const;
type ScanType = (typeof TYPES)[number];

/** 검사 로그 — 최근 50건, 상태·유형 필터 */
export default async function AdminScansPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; type?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드 (layout 가드만으로는 불충분)
  const { status, type } = await searchParams;
  const t = await getTranslations("admin");
  const tDash = await getTranslations("dashboard");
  const format = await getFormatter();

  const filter = STATUSES.includes(status as ScanStatus) ? (status as ScanStatus) : undefined;
  const typeFilter = TYPES.includes(type as ScanType) ? (type as ScanType) : undefined;

  const admin = createAdminClient();
  const buildQuery = (cols: string, withSource: boolean) => {
    let q = admin.from("scans").select(cols).order("created_at", { ascending: false }).limit(50);
    if (filter) q = q.eq("status", filter);
    // 유형 필터 — 수동/자동은 scope.manualPages 유무, 정기는 source(0029)
    if (withSource && typeFilter === "scheduled") q = q.eq("source", "scheduled");
    if (typeFilter === "manual") q = q.not("scope->manualPages", "is", null);
    if (typeFilter === "auto") {
      q = q.is("scope->manualPages", null);
      if (withSource) q = q.neq("source", "scheduled");
    }
    return q;
  };
  const SCORE_COLS =
    "manual_pages:scope->manualPages, combined:summary->scores->combined->>rate, auto_rate:summary->>complianceRate";
  type Row = {
    id: string;
    root_url: string;
    status: string;
    error: string | null;
    created_at: string;
    admin_retry?: boolean;
    source?: string;
    manual_pages?: unknown;
    combined: string | null;
    auto_rate?: string | null;
    teaser?: boolean;
    profiles: { nickname: string } | null;
  };

  // 회원 검사 — 맛보기 필터일 때는 조회 생략
  let rows: Row[] = [];
  if (typeFilter !== "teaser") {
    // admin_retry(0028)·source(0029) 미적용 환경 폴백 — 컬럼 부재로 조회가 깨지지 않게
    const first = await buildQuery(
      `id, root_url, status, error, created_at, admin_retry, source, ${SCORE_COLS}, profiles(nickname)`,
      true,
    );
    let scans = first.data;
    if (first.error)
      ({ data: scans } = await buildQuery(
        `id, root_url, status, error, created_at, ${SCORE_COLS}, profiles(nickname)`,
        false,
      ));
    rows = (scans ?? []) as unknown as Row[];
  }

  // 비로그인 맛보기(teaser_scans) — 성공한 검사만 기록되는 테이블이라 상태는 항상 done.
  // 상태 필터가 done 외로 걸려 있으면 해당 없음. 0026 미적용 환경은 오류 → 빈 목록 관용.
  if ((!typeFilter || typeFilter === "teaser") && (!filter || filter === "done")) {
    const { data: teasers } = await admin
      .from("teaser_scans")
      .select("id, hostname, rate, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    const teaserRows: Row[] = ((teasers ?? []) as { id: string; hostname: string; rate: number; created_at: string }[]).map(
      (x) => ({
        id: x.id,
        root_url: x.hostname,
        status: "done",
        error: null,
        created_at: x.created_at,
        combined: String(x.rate),
        teaser: true,
        profiles: null,
      }),
    );
    rows = [...rows, ...teaserRows]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 50);
  }

  /** 유형 판별 — 맛보기 > 정기(source) > 수동(직접 입력 페이지 존재) > 자동 수집 */
  const scanType = (s: Row): ScanType =>
    s.teaser
      ? "teaser"
      : s.source === "scheduled"
        ? "scheduled"
        : Array.isArray(s.manual_pages) && s.manual_pages.length > 0
          ? "manual"
          : "auto";

  /** 보고서 점수 — 통합 점수 우선, 없으면 자동 준수율 (대시보드와 동일 기준) */
  const scoreLabel = (s: (typeof rows)[number]): string => {
    const raw = s.combined ?? s.auto_rate;
    const n = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) ? `${n.toFixed(1)}%` : "—";
  };

  return (
    <section aria-labelledby="admin-scans-heading" className="mt-8">
      <h2 id="admin-scans-heading" className="font-display text-2xl font-bold">
        {t("scans.title")}
      </h2>

      {/* 상태·유형 필터 (GET 폼) */}
      <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="scan-status" className="mb-1 block text-sm font-semibold">
            {t("scans.filterLabel")}
          </label>
          <select
            id="scan-status"
            name="status"
            defaultValue={filter ?? ""}
            className="rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2 text-sm"
          >
            <option value="">{t("scans.filterAll")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {tDash(`status.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="scan-type" className="mb-1 block text-sm font-semibold">
            {t("scans.typeFilterLabel")}
          </label>
          <select
            id="scan-type"
            name="type"
            defaultValue={typeFilter ?? ""}
            className="rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2 text-sm"
          >
            <option value="">{t("scans.filterAll")}</option>
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`scans.type.${ty}`)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2 text-sm font-bold hover:bg-[var(--color-paper-warm)]"
        >
          {t("scans.filterApply")}
        </button>
      </form>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
          <caption className="sr-only">{t("scans.title")}</caption>
          <thead>
            <tr className="border-b-[1.5px] border-[var(--color-ink)] text-left">
              <th scope="col" className="py-2 pr-3 font-bold">{t("scans.colUser")}</th>
              <th scope="col" className="py-2 pr-3 font-bold">{t("scans.colUrl")}</th>
              <th scope="col" className="py-2 pr-3 font-bold">{t("scans.colType")}</th>
              <th scope="col" className="py-2 pr-3 font-bold">{t("scans.colStatus")}</th>
              <th scope="col" className="py-2 pr-3 font-bold">{t("scans.colScore")}</th>
              <th scope="col" className="py-2 pr-3 font-bold">{t("scans.colDate")}</th>
              <th scope="col" className="py-2 pr-3 font-bold">{t("scans.colError")}</th>
              <th scope="col" className="py-2 font-bold">{t("scans.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-[var(--color-line)]">
                <td className="whitespace-nowrap py-2 pr-3">
                  {s.teaser ? (
                    <span className="text-[var(--color-ink-faint)]">{t("scans.teaserUser")}</span>
                  ) : (
                    s.profiles?.nickname
                  )}
                </td>
                <td className="max-w-64 truncate py-2 pr-3">{s.root_url}</td>
                <td className="whitespace-nowrap py-2 pr-3">
                  <span className="rounded-full border border-[var(--color-line)] px-2 py-0.5 text-xs font-bold text-[var(--color-ink-soft)]">
                    {t(`scans.type.${scanType(s)}`)}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <StatusBadge status={s.status} label={tDash(`status.${s.status as ScanStatus}`)} />
                  {s.admin_retry && (
                    <span className="ml-1.5 rounded-full border border-[var(--color-line)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-ink-faint)]">
                      {t("scans.retryBadge")}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{scoreLabel(s)}</td>
                <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-[var(--color-ink-faint)]">
                  {format.dateTime(new Date(s.created_at), { dateStyle: "short", timeStyle: "short" })}
                </td>
                <td className="max-w-56 truncate py-2 pr-3 text-[var(--color-crit)]">{s.error}</td>
                <td className="py-2">
                  {s.status === "done" && !s.teaser && (
                    <a
                      href={`/${locale}/scans/${s.id}/report`}
                      className="text-xs font-bold text-[var(--color-seal)] underline underline-offset-2 hover:text-[var(--color-seal-deep)]"
                    >
                      {t("scans.viewReport")}
                    </a>
                  )}
                  {s.status === "failed" && <AdminRetryForm scanId={s.id} />}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-4 text-sm text-[var(--color-ink-faint)]">
                  {t("dashboard.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
