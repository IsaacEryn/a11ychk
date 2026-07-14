import { getTranslations } from "next-intl/server";

export async function Footer() {
  const t = await getTranslations("common");
  return (
    <footer className="mt-16 border-t-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper-warm)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-[var(--color-ink-soft)] sm:px-6">
        <div>
          <p className="font-display text-base font-bold text-[var(--color-ink)]">{t("appName")}</p>
          <p className="mt-1">{t("footer.tagline")}</p>
        </div>
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <li>{t("footer.standards")}</li>
          <li>
            <a
              href="https://github.com/IsaacEryn/a11ychk"
              className="font-medium underline underline-offset-4 hover:text-[var(--color-ink)]"
              rel="noopener"
            >
              {t("footer.opensource")}
            </a>
          </li>
          <li>
            {t("footer.madeBy")}{" "}
            <a
              href="https://www.codeslog.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-[var(--color-ink)] underline underline-offset-4 hover:text-[var(--color-seal)]"
            >
              isaaceryn
              <span className="sr-only"> ({t("footer.newWindow")})</span>
            </a>
          </li>
        </ul>
      </div>
    </footer>
  );
}
