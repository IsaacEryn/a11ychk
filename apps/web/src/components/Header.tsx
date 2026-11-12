import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { NavMenu } from "./NavMenu";
import { MobileNav } from "./MobileNav";
import { ThemeToggle } from "./ThemeToggle";
import { AdminNavLink } from "./AdminNavLink";
import { signOut } from "@/lib/actions";

/**
 * 사이트 헤더 — 정적 HTML에 로그인·비로그인 메뉴를 함께 담는다.
 *
 * 사용자를 읽으면 레이아웃 아래 모든 페이지가 요청마다 렌더되므로 서버는 사용자를 모른다. 대신
 * .auth-in/.auth-out(globals.css)이 <html data-auth>로 한쪽만 보이게 한다 — 첫 페인트 전에 boot 스크립트가
 * 값을 정하므로 깜빡이지 않는다. 숨은 쪽은 display:none이라 스크린리더·탭 순서에도 나오지 않는다.
 * 회원 메뉴의 링크는 원래 공개 주소이고(들어가면 서버가 로그인을 요구한다), 비밀인 관리자 주소만
 * AdminNavLink가 관리자에게만 따로 받아 온다.
 */
export async function Header() {
  const t = await getTranslations("common");

  const linkCls =
    "rounded px-2 py-1 text-[0.95rem] font-medium text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:underline underline-offset-4";

  return (
    <header className="sticky top-0 z-40 border-b-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 py-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]">
        <Link href="/" className="flex items-center gap-2 rounded">
          {/* 브랜드 마크 (brand/a11y-check-mark.svg) — 자체 배경색을 가져 테마 무관 */}
          <svg aria-hidden="true" viewBox="0 0 64 64" className="h-6 w-6 shrink-0">
            <rect width="64" height="64" rx="14" fill="#0f1c2e" />
            <circle cx="10" cy="54" r="4.2" fill="#4d8dff" />
            <circle cx="20" cy="54" r="3.2" fill="#4d8dff" />
            <circle cx="30" cy="54" r="2.2" fill="#4d8dff" opacity="0.7" />
            <circle cx="40" cy="54" r="1.4" fill="#4d8dff" opacity="0.45" />
            <circle cx="10" cy="44" r="3.2" fill="#4d8dff" />
            <circle cx="20" cy="44" r="2.2" fill="#4d8dff" opacity="0.7" />
            <circle cx="30" cy="44" r="1.4" fill="#4d8dff" opacity="0.45" />
            <circle cx="10" cy="34" r="2.2" fill="#4d8dff" opacity="0.7" />
            <circle cx="20" cy="34" r="1.4" fill="#4d8dff" opacity="0.45" />
            <circle cx="10" cy="24" r="1.4" fill="#4d8dff" opacity="0.45" />
            <path d="M22 32 L31 41.5 L52 14" fill="none" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-display text-xl font-bold tracking-tight">{t("appName")}</span>
        </Link>

        <nav aria-label="주 메뉴" className="hidden flex-1 flex-wrap items-center gap-x-1 gap-y-1 md:flex">
          <Link href="/about" className={linkCls}>
            {t("nav.about")}
          </Link>
          <div className="auth-in">
            <NavMenu
              label={t("nav.audit")}
              items={[
                { href: "/scan", label: t("nav.scan") },
                { href: "/access-check", label: t("nav.accessCheck") },
                { href: "/extension/connect", label: t("nav.extension") },
              ]}
            />
          </div>
          <Link href="/guide" className={linkCls}>
            {t("nav.guide")}
          </Link>
          <Link href="/directory" className={linkCls}>
            {t("nav.directory")}
          </Link>
          <div className="auth-in">
            <NavMenu
              label={t("nav.my")}
              items={[
                { href: "/dashboard", label: t("nav.dashboard") },
                { href: "/mypage", label: t("nav.mypage") },
                { href: "/inquiries", label: t("nav.inquiries") },
              ]}
            />
          </div>
          <AdminNavLink label={t("nav.admin")} className={linkCls} />
        </nav>

        <div className="hidden items-center gap-3 md:flex">
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
          <form action={signOut} className="auth-in">
            <button
              type="submit"
              className="rounded border-[1.5px] border-[var(--color-ink)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--color-paper-warm)]"
            >
              {t("auth.logout")}
            </button>
          </form>
          <Link
            href="/login"
            className="auth-out rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-3 py-1.5 text-sm font-semibold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] hover:border-[var(--color-seal-deep)]"
          >
            {t("auth.login")}
          </Link>
        </div>

        {/* 모바일 전용 햄버거 + 드롭다운 패널 (md 미만). 패널은 헤더(sticky) 기준 전폭 앵커 — relative 미부여 */}
        <MobileNav
          className="ml-auto md:hidden"
          themeLabel={t("theme.label")}
          themeLabels={{
            system: t("theme.system"),
            light: t("theme.light"),
            dark: t("theme.dark"),
            contrast: t("theme.contrast"),
          }}
          localeLabel={t("localeSwitcher")}
          labels={{
            openMenu: t("menu.open"),
            closeMenu: t("menu.close"),
            about: t("nav.about"),
            guide: t("nav.guide"),
            directory: t("nav.directory"),
            auditGroup: t("nav.audit"),
            scan: t("nav.scan"),
            accessCheck: t("nav.accessCheck"),
            extension: t("nav.extension"),
            myGroup: t("nav.my"),
            dashboard: t("nav.dashboard"),
            mypage: t("nav.mypage"),
            inquiries: t("nav.inquiries"),
            admin: t("nav.admin"),
            login: t("auth.login"),
            logout: t("auth.logout"),
          }}
        />
      </div>
    </header>
  );
}
