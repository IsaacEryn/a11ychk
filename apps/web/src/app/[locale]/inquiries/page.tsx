import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createInquiry } from "@/lib/actions";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "inquiries" });
  return { title: t("title") };
}

export default async function InquiriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("inquiries");
  const format = await getFormatter();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  const { data: inquiries } = await supabase
    .from("inquiries")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const statusStyle: Record<string, string> = {
    open: "border-[var(--color-line)] text-[var(--color-ink-faint)]",
    answered: "border-[var(--color-seal)] text-[var(--color-seal)]",
    closed: "border-[var(--color-line)] text-[var(--color-ink-faint)] line-through",
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-[var(--color-ink-soft)]">{t("desc")}</p>

      {/* 새 문의 */}
      <form action={createInquiry} className="doc-card mt-8 p-6">
        <fieldset>
          <legend className="font-display text-xl font-bold">{t("new.legend")}</legend>

          <div className="mt-4">
            <label htmlFor="inq-type" className="mb-1 block text-sm font-semibold">
              {t("new.type")}
            </label>
            <select
              id="inq-type"
              name="type"
              className="rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2"
            >
              <option value="feature">{t("new.typeFeature")}</option>
              <option value="bug">{t("new.typeBug")}</option>
              <option value="question">{t("new.typeQuestion")}</option>
            </select>
          </div>

          <div className="mt-4">
            <label htmlFor="inq-title" className="mb-1 block text-sm font-semibold">
              {t("new.subject")}
            </label>
            <input
              id="inq-title"
              name="title"
              type="text"
              required
              maxLength={200}
              className="w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2"
            />
          </div>

          <div className="mt-4">
            <label htmlFor="inq-body" className="mb-1 block text-sm font-semibold">
              {t("new.body")}
            </label>
            <textarea
              id="inq-body"
              name="body"
              required
              rows={5}
              maxLength={5000}
              className="w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2"
            />
          </div>

          <button
            type="submit"
            className="mt-4 rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
          >
            {t("new.submit")}
          </button>
        </fieldset>
      </form>

      {/* 내 문의 */}
      <section aria-labelledby="my-inquiries-heading" className="mt-10">
        <h2 id="my-inquiries-heading" className="font-display text-2xl font-bold">
          {t("list.title")}
        </h2>
        {!inquiries || inquiries.length === 0 ? (
          <p className="mt-4 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-[var(--color-ink-faint)]">
            {t("list.empty")}
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {inquiries.map((q) => (
              <li key={q.id} className="doc-card p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border-[1.5px] px-2.5 py-0.5 text-xs font-bold ${statusStyle[q.status]}`}>
                    {t(`list.status.${q.status as "open" | "answered" | "closed"}`)}
                  </span>
                  <span className="rounded-full bg-[var(--color-paper-warm)] px-2.5 py-0.5 text-xs font-semibold text-[var(--color-ink-soft)]">
                    {t(`new.type${(q.type as string).charAt(0).toUpperCase() + (q.type as string).slice(1)}` as Parameters<typeof t>[0])}
                  </span>
                  <h3 className="min-w-0 flex-1 font-bold">{q.title}</h3>
                  <time dateTime={q.created_at} className="text-xs tabular-nums text-[var(--color-ink-faint)]">
                    {format.dateTime(new Date(q.created_at), { dateStyle: "medium" })}
                  </time>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-ink-soft)]">{q.body}</p>
                {q.admin_reply && (
                  <div className="mt-3 border-l-[3px] border-[var(--color-seal)] bg-[var(--color-seal-tint)] p-3">
                    <p className="text-xs font-bold text-[var(--color-seal)]">{t("list.adminReply")}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{q.admin_reply}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
