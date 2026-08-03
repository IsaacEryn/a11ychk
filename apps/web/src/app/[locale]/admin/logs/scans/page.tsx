import { requireAdmin } from "@/lib/adminGuard";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminBase } from "@/lib/adminSlug";
import { escapeLike } from "@/lib/like";
import { StatusBadge } from "@/components/StatusBadge";
import { AdminRetryForm } from "./AdminRetryForm";
import { Pager, PAGE_SIZE, parsePage } from "../../Pager";
import { FILTER_BTN, INPUT, TABLE, TH, TR, TR_HEAD } from "../../tableStyles";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("scans.title")} — ${t("title")}` };
}

const STATUSES = ["queued", "running", "done", "failed"] as const;
type ScanStatus = (typeof STATUSES)[number];
// teaser = 비로그인 맛보기(teaser_scans, 0026) — 별도 테이블이라 유형 선택 시에만 조회
// (과거의 메모리 병합 표시는 페이징과 양립할 수 없어 해체 — "전체"는 회원 검사만)
const TYPES = ["manual", "auto", "scheduled", "teaser"] as const;
type ScanType = (typeof TYPES)[number];

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

/** 검사 로그 — 페이징 + 상태·유형 필터 + URL·닉네임 검색 */
export default async function AdminScanLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; status?: string; type?: string; q?: string; nick?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드 (layout 가드만으로는 불충분)
  const sp = await searchParams;
  const t = await getTranslations("admin");
  const tDash = await getTranslations("dashboard");
  const format = await getFormatter();

  const page = parsePage(sp.page);
  const filter = STATUSES.includes(sp.status as ScanStatus) ? (sp.status as ScanStatus) : undefined;
  const typeFilter = TYPES.includes(sp.type as ScanType) ? (sp.type as ScanType) : undefined;
  const q = (sp.q ?? "").trim();
  const nick = (sp.nick ?? "").trim();
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = page * PAGE_SIZE - 1;

  const admin = createAdminClient();
  let rows: Row[] = [];
  let total = 0;

  if (typeFilter === "teaser") {
    // 맛보기 — 성공 검사만 기록되는 테이블(상태 항상 done)·비로그인이라 닉네임 없음.
    // done 외 상태나 닉네임 검색이 걸려 있으면 해당 없음(0건) — 필터를 무시하면 오독을 만든다.
    if ((filter && filter !== "done") || nick) {
      rows = [];
      total = 0;
    } else {
    // q는 호스트명 검색으로 동작
    let query = admin
      .from("teaser_scans")
      .select("id, hostname, rate, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(rangeFrom, rangeTo);
    if (q) query = query.ilike("hostname", `%${escapeLike(q)}%`);
    const { data, count } = await query.then(
      (r) => r,
      () => ({ data: null, count: null }),
    );
    rows = ((data ?? []) as { id: string; hostname: string; rate: number; created_at: string }[]).map((x) => ({
      id: x.id,
      root_url: x.hostname,
      status: "done",
      error: null,
      created_at: x.created_at,
      combined: String(x.rate),
      teaser: true,
      profiles: null,
    }));
    total = count ?? 0;
    }
  } else {
    // 닉네임 검색 — profiles 선조회 후 user_id로 좁힌다 (0건이면 단락)
    let userIds: string[] | null = null;
    if (nick) {
      const { data } = await admin
        .from("profiles")
        .select("id")
        .ilike("nickname", `%${escapeLike(nick)}%`)
        .order("created_at", { ascending: false })
        .limit(100);
      userIds = (data ?? []).map((p) => p.id as string);
    }

    if (userIds === null || userIds.length > 0) {
      const buildQuery = (cols: string, withSource: boolean) => {
        let query = admin
          .from("scans")
          .select(cols, { count: "exact" })
          .order("created_at", { ascending: false })
          .range(rangeFrom, rangeTo);
        if (filter) query = query.eq("status", filter);
        // 유형 필터 — 수동/자동은 scope.manualPages 유무, 정기는 source(0029)
        if (withSource && typeFilter === "scheduled") query = query.eq("source", "scheduled");
        if (typeFilter === "manual") query = query.not("scope->manualPages", "is", null);
        if (typeFilter === "auto") {
          query = query.is("scope->manualPages", null);
          if (withSource) query = query.neq("source", "scheduled");
        }
        if (q) query = query.ilike("root_url", `%${escapeLike(q)}%`);
        if (userIds) query = query.in("user_id", userIds);
        return query;
      };
      const SCORE_COLS =
        "manual_pages:scope->manualPages, combined:summary->scores->combined->>rate, auto_rate:summary->>complianceRate";
      // admin_retry(0028)·source(0029) 미적용 환경 폴백 — 컬럼 부재로 조회가 깨지지 않게
      const first = await buildQuery(
        `id, root_url, status, error, created_at, admin_retry, source, ${SCORE_COLS}, profiles(nickname)`,
        true,
      );
      let scans = first.data;
      let count = first.count;
      if (first.error) {
        const fallback = await buildQuery(
          `id, root_url, status, error, created_at, ${SCORE_COLS}, profiles(nickname)`,
          false,
        );
        scans = fallback.data;
        count = fallback.count;
      }
      rows = (scans ?? []) as unknown as Row[];
      total = count ?? 0;
    }
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
  const scoreLabel = (s: Row): string => {
    const raw = s.combined ?? s.auto_rate;
    const n = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) ? `${n.toFixed(1)}%` : "—";
  };

  const filterQuery: Record<string, string> = {};
  if (filter) filterQuery.status = filter;
  if (typeFilter) filterQuery.type = typeFilter;
  if (q) filterQuery.q = q;
  if (nick) filterQuery.nick = nick;

  return (
    <section aria-labelledby="admin-scans-heading" className="mt-5">
      <h3 id="admin-scans-heading" className="sr-only">
        {t("scans.title")}
      </h3>

      {/* 상태·유형·검색 필터 (GET 폼) */}
      <form method="get" className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="scan-status" className="mb-1 block text-sm font-semibold">
            {t("scans.filterLabel")}
          </label>
          <select id="scan-status" name="status" defaultValue={filter ?? ""} className={INPUT}>
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
          <select id="scan-type" name="type" defaultValue={typeFilter ?? ""} className={INPUT}>
            <option value="">{t("scans.allMembers")}</option>
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`scans.type.${ty}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="scan-q" className="mb-1 block text-sm font-semibold">
            {t("scans.searchUrl")}
          </label>
          <input id="scan-q" type="search" name="q" defaultValue={q} className={INPUT} />
        </div>
        <div>
          <label htmlFor="scan-nick" className="mb-1 block text-sm font-semibold">
            {t("scans.searchNick")}
          </label>
          <input id="scan-nick" type="search" name="nick" defaultValue={nick} className={INPUT} />
        </div>
        <button type="submit" className={FILTER_BTN}>
          {t("scans.filterApply")}
        </button>
      </form>

      <div className="mt-4 overflow-x-auto">
        <table className={TABLE}>
          <caption className="sr-only">{t("scans.title")}</caption>
          <thead>
            <tr className={TR_HEAD}>
              <th scope="col" className={TH}>{t("scans.colUser")}</th>
              <th scope="col" className={TH}>{t("scans.colUrl")}</th>
              <th scope="col" className={TH}>{t("scans.colType")}</th>
              <th scope="col" className={TH}>{t("scans.colStatus")}</th>
              <th scope="col" className={TH}>{t("scans.colScore")}</th>
              <th scope="col" className={TH}>{t("scans.colDate")}</th>
              <th scope="col" className={TH}>{t("scans.colError")}</th>
              <th scope="col" className="py-2 font-bold">{t("scans.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className={TR}>
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

      <Pager pathname={`${adminBase()}/logs/scans`} query={filterQuery} page={page} total={total} />
    </section>
  );
}
