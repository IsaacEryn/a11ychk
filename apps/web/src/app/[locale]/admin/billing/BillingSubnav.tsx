import { getTranslations } from "next-intl/server";
import { adminBase } from "@/lib/adminSlug";
import { AdminLink } from "../AdminLink";

type Current = "list" | "prices" | "tools";

/**
 * 결제 화면 보조 메뉴 — 목록 · 가격 · 테스트 도구. 현재 화면은 aria-current="page"로 알린다.
 * 서버 컴포넌트라 현재 위치를 prop으로 받는다(각 page가 자기 위치를 안다).
 */
export async function BillingSubnav({ current }: { current: Current }) {
  const t = await getTranslations("admin.billing.subnav");
  const base = `${adminBase()}/billing`;
  const items: { key: Current; href: string }[] = [
    { key: "list", href: base },
    { key: "prices", href: `${base}/prices` },
    { key: "tools", href: `${base}/tools` },
  ];
  return (
    <nav aria-label={t("label")} className="mt-4 border-b border-[var(--color-line)]">
      <ul className="flex flex-wrap gap-1">
        {items.map((item) => {
          const isCurrent = item.key === current;
          return (
            <li key={item.key}>
              <AdminLink
                href={item.href}
                aria-current={isCurrent ? "page" : undefined}
                className={`block border-b-[3px] px-3 py-1.5 text-sm font-bold ${
                  isCurrent
                    ? "border-[var(--color-seal)] text-[var(--color-seal)]"
                    : "border-transparent text-[var(--color-ink-soft)] hover:border-[var(--color-line)] hover:text-[var(--color-ink)]"
                }`}
              >
                {t(item.key)}
              </AdminLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
