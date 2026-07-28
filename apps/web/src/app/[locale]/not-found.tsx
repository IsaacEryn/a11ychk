import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function NotFoundPage() {
  const t = await getTranslations("errors");
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center sm:px-6">
      {/* 큰 404는 순수 장식 — 실제 메시지는 아래 h1이 전한다(WCAG 1.4.3의 장식 예외).
          HTML 텍스트로 두면 의도한 옅은 색이 명도 대비 위반으로 잡히므로 SVG로 그린다.
          랜딩의 SAMPLE 워터마크와 같은 처리. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 160 60"
        className="mx-auto h-20 w-40 select-none fill-[var(--color-line)]"
      >
        <text x="80" y="48" textAnchor="middle" className="font-display text-[3.5rem] font-extrabold">
          404
        </text>
      </svg>
      <h1 className="font-display mt-4 text-2xl font-bold">{t("notFoundTitle")}</h1>
      <p className="mt-2 text-[var(--color-ink-soft)]">{t("notFoundDesc")}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-block rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)]"
        >
          {t("goHome")}
        </Link>
        <Link href="/scan" className="inline-block rounded border-[1.5px] border-[var(--color-ink)] px-5 py-2.5 font-bold">
          {t("goScan")}
        </Link>
      </div>
      <p className="mt-6 text-sm text-[var(--color-ink-soft)]">
        {t("persistPrefix")}{" "}
        <Link href="/inquiries" className="font-semibold text-[var(--color-seal)] underline underline-offset-4">
          {t("contact")}
        </Link>
      </p>
    </div>
  );
}
