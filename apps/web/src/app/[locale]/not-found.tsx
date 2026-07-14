import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function NotFoundPage() {
  const t = await getTranslations("errors");
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center sm:px-6">
      <p className="font-display text-7xl font-extrabold text-[var(--color-line)]" aria-hidden="true">
        404
      </p>
      <h1 className="font-display mt-4 text-2xl font-bold">{t("notFoundTitle")}</h1>
      <p className="mt-2 text-[var(--color-ink-soft)]">{t("notFoundDesc")}</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)]"
      >
        {t("goHome")}
      </Link>
    </div>
  );
}
