import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { LocaleSwitcher } from "./LocaleSwitcher";
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
        <Link href="/" className="flex items-baseline gap-2 rounded">
          <span aria-hidden="true" className="inline-block h-3.5 w-3.5 translate-y-px rounded-[3px] outline-3 outline-offset-2 outline-[var(--color-seal)]" />
          <span className="font-display text-xl font-bold tracking-tight">{t("appName")}</span>
        </Link>

        <nav aria-label="주 메뉴" className="flex flex-1 flex-wrap items-center gap-x-1 gap-y-1">
          <Link href="/guide" className={linkCls}>
            {t("nav.guide")}
          </Link>
          {user && (
            <>
              <Link href="/scan" className={linkCls}>
                {t("nav.scan")}
              </Link>
              <Link href="/dashboard" className={linkCls}>
                {t("nav.dashboard")}
              </Link>
              <Link href="/mypage" className={linkCls}>
                {t("nav.mypage")}
              </Link>
              <Link href="/inquiries" className={linkCls}>
                {t("nav.inquiries")}
              </Link>
              {isAdmin && (
                <Link href="/admin" className={linkCls}>
                  {t("nav.admin")}
                </Link>
              )}
            </>
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
