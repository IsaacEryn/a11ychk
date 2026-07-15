import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { replyInquiry } from "@/lib/actions";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.inquiries")} — ${t("title")}` };
}

/** 문의 관리 — 목록 + 답변 */
export default async function AdminInquiriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  const format = await getFormatter();

  const admin = createAdminClient();
  const { data: inquiries } = await admin
    .from("inquiries")
    .select("id, type, title, body, status, admin_reply, created_at, profiles(nickname)")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <section aria-labelledby="admin-inquiries-heading" className="mt-8">
      <h2 id="admin-inquiries-heading" className="font-display text-2xl font-bold">
        {t("inquiriesSection.title")}
      </h2>
      <ul className="mt-4 space-y-4">
        {(inquiries ?? []).map((q) => (
          <li key={q.id} className="doc-card p-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold">{q.title}</span>
              <span className="text-[var(--color-ink-faint)]">
                {t("inquiriesSection.from")}: {(q.profiles as unknown as { nickname: string } | null)?.nickname} ·{" "}
                {format.dateTime(new Date(q.created_at), { dateStyle: "short" })} · {q.type} · {q.status}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-ink-soft)]">{q.body}</p>
            <form action={replyInquiry} className="mt-3 border-t border-dashed border-[var(--color-line)] pt-3">
              <input type="hidden" name="id" value={q.id} />
              <label htmlFor={`reply-${q.id}`} className="mb-1 block text-xs font-bold">
                {t("inquiriesSection.replyLabel")}
              </label>
              <textarea
                id={`reply-${q.id}`}
                name="reply"
                rows={2}
                required
                defaultValue={q.admin_reply ?? ""}
                className="w-full rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="mt-2 rounded border-[1.5px] border-[var(--color-seal)] px-3 py-1.5 text-sm font-bold text-[var(--color-seal)] hover:bg-[var(--color-seal-tint)]"
              >
                {t("inquiriesSection.send")}
              </button>
            </form>
          </li>
        ))}
        {(inquiries ?? []).length === 0 && (
          <li className="py-4 text-sm text-[var(--color-ink-faint)]">{t("dashboard.empty")}</li>
        )}
      </ul>
    </section>
  );
}
