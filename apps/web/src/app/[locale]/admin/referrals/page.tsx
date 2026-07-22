import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { approveReferral, rejectReferral } from "@/lib/actions";

/**
 * 관리자 초대 관리 — suspect(의심) 건을 우선 표시하고 승인/기각으로 심사한다.
 * referrals는 service role 전용(RLS 정책 0) — 조회·갱신 모두 admin 클라이언트.
 * migration 0024 미적용 환경은 빈 목록으로 표시된다.
 */
export default async function AdminReferralsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin.referrals");
  const format = await getFormatter();

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("referrals")
    .select("id, referrer_id, invitee_id, status, suspect_reason, appeal_note, signup_ip, created_at, validated_at")
    .order("created_at", { ascending: false })
    .limit(200)
    .then((r) => r, () => ({ data: null }));

  const referrals = rows ?? [];
  // suspect 우선 정렬 (그 안에서는 최신순 유지)
  const order = { suspect: 0, pending: 1, valid: 2, rejected: 3 } as Record<string, number>;
  referrals.sort((a, b) => (order[a.status as string] ?? 9) - (order[b.status as string] ?? 9));

  // 닉네임 병기 — 관련 사용자만 일괄 조회
  const userIds = [
    ...new Set(referrals.flatMap((r) => [r.referrer_id as string, r.invitee_id as string | null]).filter(Boolean)),
  ] as string[];
  const { data: profiles } =
    userIds.length > 0
      ? await admin.from("profiles").select("id, nickname").in("id", userIds)
      : { data: [] as { id: string; nickname: string | null }[] };
  const nickname = new Map((profiles ?? []).map((p) => [p.id as string, (p.nickname as string | null) ?? "?"]));

  const statusStyle: Record<string, string> = {
    valid: "bg-[var(--color-seal-tint)] text-[var(--color-seal)]",
    suspect: "bg-[var(--color-warn-tint)] text-[var(--color-ink)]",
    rejected: "bg-[var(--color-crit-tint)] text-[var(--color-crit)]",
    pending: "bg-[var(--color-paper-warm)] text-[var(--color-ink-soft)]",
  };

  return (
    <section className="mt-8">
      <h2 className="font-display text-2xl font-bold">{t("title")}</h2>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{t("intro")}</p>

      {referrals.length === 0 ? (
        <p className="mt-4 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-[var(--color-ink-faint)]">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
            <caption className="sr-only">{t("title")}</caption>
            <thead>
              <tr className="border-b-[1.5px] border-[var(--color-ink)] text-left">
                <th scope="col" className="py-2 pr-3 font-bold">{t("colStatus")}</th>
                <th scope="col" className="py-2 pr-3 font-bold">{t("colReferrer")}</th>
                <th scope="col" className="py-2 pr-3 font-bold">{t("colInvitee")}</th>
                <th scope="col" className="py-2 pr-3 font-bold">{t("colIp")}</th>
                <th scope="col" className="py-2 pr-3 font-bold">{t("colAppeal")}</th>
                <th scope="col" className="py-2 pr-3 font-bold">{t("colDate")}</th>
                <th scope="col" className="py-2 font-bold">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <tr key={r.id as string} className="border-b border-[var(--color-line)] align-top">
                  <td className="py-2.5 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusStyle[r.status as string] ?? ""}`}>
                      {t(`status.${r.status as "pending" | "valid" | "suspect" | "rejected"}`)}
                    </span>
                    {typeof r.suspect_reason === "string" && r.suspect_reason && (
                      <span className="ml-1 text-xs text-[var(--color-ink-faint)]">({r.suspect_reason})</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">{nickname.get(r.referrer_id as string) ?? "?"}</td>
                  <td className="py-2.5 pr-3">
                    {r.invitee_id ? (nickname.get(r.invitee_id as string) ?? "?") : t("inviteeGone")}
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums text-xs text-[var(--color-ink-faint)]">
                    {(r.signup_ip as string | null) ?? "—"}
                  </td>
                  <td className="max-w-64 py-2.5 pr-3 text-xs text-[var(--color-ink-soft)]">
                    {(r.appeal_note as string | null) || "—"}
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums text-xs text-[var(--color-ink-faint)]">
                    {format.dateTime(new Date(r.created_at as string), { dateStyle: "short" })}
                  </td>
                  <td className="py-2.5">
                    {r.status === "suspect" && (
                      <div className="flex gap-1.5">
                        <form action={approveReferral}>
                          <input type="hidden" name="id" value={r.id as string} />
                          <button
                            type="submit"
                            className="rounded border-[1.5px] border-[var(--color-seal)] px-2.5 py-1 text-xs font-bold text-[var(--color-seal)] hover:bg-[var(--color-seal-tint)]"
                          >
                            {t("approve")}
                          </button>
                        </form>
                        <form action={rejectReferral}>
                          <input type="hidden" name="id" value={r.id as string} />
                          <button
                            type="submit"
                            className="rounded border-[1.5px] border-[var(--color-crit)] px-2.5 py-1 text-xs font-bold text-[var(--color-crit)] hover:bg-[var(--color-crit-tint)]"
                          >
                            {t("reject")}
                          </button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
