import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { NavMenu } from "./NavMenu";
import { ThemeToggle } from "./ThemeToggle";
import { signOut } from "@/lib/actions";

export async function Header() {
  const t = await getTranslations("common");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isAdmin = false;
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    isAdmin = profile?.role === "admin";
  }

  const linkCls =
    "rounded px-2 py-1 text-[0.95rem] font-medium text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:underline underline-offset-4";

  return (
    <header className="border-b-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 rounded">
          {/* 로고 — 포커스 링 안의 체크마크. 테마 토큰으로 색이 자동 전환된다 */}
          <svg aria-hidden="true" viewBox="0 0 64 64" className="h-6 w-6 shrink-0">
            <rect x="3" y="3" width="58" height="58" rx="15" fill="none" stroke="var(--color-seal)" strokeWidth="5" />
            <rect x="13.5" y="13.5" width="37" height="37" rx="8" fill="var(--color-seal)" />
            <path d="M22.5 33.5 L29.5 40.5 L42 25.5" fill="none" stroke="var(--color-paper)" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-display text-xl font-bold tracking-tight">{t("appName")}</span>
        </Link>

        <nav aria-label="주 메뉴" className="flex flex-1 flex-wrap items-center gap-x-1 gap-y-1">
          <Link href="/about" className={linkCls}>
            {t("nav.about")}
          </Link>
          {user && (
            <NavMenu
              label={t("nav.audit")}
              items={[
                { href: "/scan", label: t("nav.scan") },
                { href: "/access-check", label: t("nav.accessCheck") },
                { href: "/extension/connect", label: t("nav.extension") },
              ]}
            />
          )}
          <Link href="/guide" className={linkCls}>
            {t("nav.guide")}
          </Link>
          {user && (
            <NavMenu
              label={t("nav.my")}
              items={[
                { href: "/dashboard", label: t("nav.dashboard") },
                { href: "/mypage", label: t("nav.mypage") },
                { href: "/inquiries", label: t("nav.inquiries") },
              ]}
            />
          )}
          {user && isAdmin && (
            <Link href="/admin" className={linkCls}>
              {t("nav.admin")}
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3">
          <ThemeToggle
            label={t("theme.label")}
            labels={{
              system: t("theme.system"),
              light: t("theme.light"),
              dark: t("theme.dark"),
              contrast: t("theme.contrast"),
            }}
          />
          <LocaleSwitcher label={t("localeSwitcher")} />
          {user ? (
            <form action={signOut}>
              <button
                type="submit"
                className="rounded border-[1.5px] border-[var(--color-ink)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--color-paper-warm)]"
              >
                {t("auth.logout")}
              </button>
            </form>
          ) : (
            <Link
              href="/login"
              className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-3 py-1.5 text-sm font-semibold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] hover:border-[var(--color-seal-deep)]"
            >
              {t("auth.login")}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
