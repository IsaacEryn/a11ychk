import { setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo/alternates";

/**
 * 크롤러 안내 — 검사 브라우저의 User-Agent가 가리키는 주소(+https://a11ychk.com/bot).
 * 서버 로그에서 a11ychk-bot을 본 사이트 운영자가 "무엇이 왜 왔는지, 어떻게 막는지"를 확인하는 곳.
 * 조문형 짧은 문서라 privacy·terms처럼 페이지 안에 두 언어를 정의한다.
 * 사실 주장(동시 페이지 2개·이미지 차단·robots 적용 범위·소유자 예외·접근 진단의 브라우저 UA)은
 * runScan.ts(buildScanSample)·robots.ts·checkAccess.ts와 맞춰야 한다.
 */
interface Section {
  heading: string;
  body: string[];
  code?: string;
}

const UA = "Mozilla/5.0 (compatible; a11ychk-bot/0.1; +https://a11ychk.com/bot)";

const CONTENT: Record<"ko" | "en", { title: string; lead: string; sections: Section[] }> = {
  ko: {
    title: "a11ychk-bot 안내",
    lead: "a11ychk-bot은 웹 접근성 점검 서비스 A11y Check가 페이지를 검사할 때 쓰는 브라우저입니다. 서버 로그에서 이 이름을 보셨다면 누군가 이 서비스에서 해당 사이트의 접근성 검사를 요청한 것입니다. 이 서비스의 MCP 서버가 대표 페이지를 모을 때(crawl_sample)도 robots.txt를 확인하며 같은 이름을 씁니다.",
    sections: [
      {
        heading: "무엇을 하나요",
        body: [
          "사이트 주소를 받으면 sitemap.xml과 첫 페이지의 링크에서 대표 페이지(많아야 30여 개)를 고른 뒤, 헤드리스 Chromium으로 각 페이지를 열어 WCAG 2.2와 KWCAG 2.2 기준으로 검사합니다.",
          "검색 색인이나 콘텐츠 수집을 하지 않습니다. 검사 결과는 검사를 요청한 사용자의 보고서에 쓰이고, 로그인 없이 하는 맛보기 검사는 도메인과 요약 수치만 운영 통계로 남깁니다. 사이트 소유를 확인한 사용자는 요약 점수를 배지로 사이트에 붙일 수 있고, 공개를 선택하면 공개 목록에도 나옵니다.",
        ],
      },
      {
        heading: "언제 방문하나요",
        body: [
          "사용자가 검사를 실행했을 때만 방문합니다. 검사 한 건이 한 번에 여는 페이지는 기본 2개(설정에 따라 최대 3개)이고, 여러 사용자가 같은 사이트를 동시에 검사하면 그만큼 늘어납니다. 이미지와 동영상은 내려받지 않습니다.",
          "매일·매주·매월 반복되는 정기 검사는 사이트 소유를 확인한 사용자만 켤 수 있습니다.",
        ],
      },
      {
        heading: "User-Agent",
        body: ["검사 브라우저는 아래 User-Agent를 보냅니다. 방화벽이나 봇 차단 규칙에서 허용하거나 막을 때 a11ychk-bot 부분으로 식별하시면 됩니다. 예외로, 사이트 접근 진단 기능은 robots.txt와 관계없이 입력된 주소를 한 번 요청하고, 봇 차단 여부를 비교하려고 일반 브라우저 User-Agent로 한 번 더 요청할 수 있습니다."],
        code: UA,
      },
      {
        heading: "방문을 막으려면",
        body: [
          "robots.txt를 따릅니다. 아래처럼 쓰면 검사를 요청받아도 robots.txt와 검사를 요청받은 주소를 확인하는 요청 외에는 페이지를 열지 않습니다. 검사자가 페이지 주소를 직접 지정한 경우에도 막힌 페이지는 건너뜁니다. a11ychk-bot 그룹이 없으면 User-agent: * 그룹의 규칙을 따릅니다.",
        ],
        code: "User-agent: a11ychk-bot\nDisallow: /",
      },
      {
        heading: "사이트 소유자 예외",
        body: [
          "사이트 소유를 확인한 사용자(DNS·메타 태그·파일로 확인)가 자기 사이트의 페이지를 직접 지정해 검사하면 robots.txt와 관계없이 검사합니다. 봇을 막아 둔 스테이징 사이트를 검사할 수 있게 하기 위해서입니다.",
        ],
      },
      {
        heading: "문의",
        body: ["방문 빈도나 동작에 문제가 있으면 isaaceryn@gmail.com 으로 알려 주세요."],
      },
    ],
  },
  en: {
    title: "About a11ychk-bot",
    lead: "a11ychk-bot is the browser the web accessibility service A11y Check uses to audit pages. If you see it in your server logs, someone asked this service to check your site's accessibility. The service's MCP server also uses this name when it fetches robots.txt while collecting representative pages (crawl_sample).",
    sections: [
      {
        heading: "What it does",
        body: [
          "Given a site address, it picks representative pages (about 30 at most) from sitemap.xml and links on the home page, opens each in headless Chromium, and checks it against WCAG 2.2 and KWCAG 2.2.",
          "It does not index for search or harvest content. Results go into the report of the user who requested the audit; no-login quick checks keep only the domain and summary figures as service statistics. A user who verified ownership of the site can embed the summary score as a badge, and it appears in the public directory if they choose to publish.",
        ],
      },
      {
        heading: "When it visits",
        body: [
          "Only when a user runs an audit. Each audit opens 2 pages at a time by default (up to 3 depending on configuration); if several users audit the same site at once, that adds up. Images and video are not downloaded.",
          "Recurring daily, weekly or monthly audits can be enabled only by users who have verified ownership of the site.",
        ],
      },
      {
        heading: "User-Agent",
        body: ["The audit browser sends the User-Agent below. Match on the a11ychk-bot token to allow or block it in firewall or bot rules. One exception: the site access check requests the entered address once regardless of robots.txt, and may request it once more with a regular browser User-Agent to compare bot blocking."],
        code: UA,
      },
      {
        heading: "Blocking visits",
        body: [
          "We follow robots.txt. With the rules below, apart from requests that check robots.txt and the address the audit was requested for, we will not open your pages even when an audit is requested. Pages a user enters by hand are skipped too if robots.txt blocks them. Without an a11ychk-bot group, the User-agent: * group applies.",
        ],
        code: "User-agent: a11ychk-bot\nDisallow: /",
      },
      {
        heading: "Site owner exception",
        body: [
          "When a user who has verified ownership of the site (via DNS, meta tag or file) enters pages of that site by hand, we audit them regardless of robots.txt, so owners can check staging sites that block bots.",
        ],
      },
      {
        heading: "Contact",
        body: ["If visits cause problems, let us know at isaaceryn@gmail.com."],
      },
    ],
  },
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const c = CONTENT[locale === "en" ? "en" : "ko"];
  return {
    alternates: localeAlternates(locale, "/bot"),
    title: c.title,
    description: c.lead,
  };
}

export default async function BotPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const c = CONTENT[locale === "en" ? "en" : "ko"];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-bold">{c.title}</h1>
      <p className="mt-4 leading-relaxed text-[var(--color-ink-soft)]">{c.lead}</p>
      {c.sections.map((s) => (
        <section key={s.heading} className="mt-8">
          <h2 className="font-display text-xl font-bold">{s.heading}</h2>
          {s.body.map((p, i) => (
            <p key={i} className="mt-2 leading-relaxed text-[var(--color-ink-soft)]">
              {p}
            </p>
          ))}
          {s.code && (
            <pre className="mt-3 overflow-x-auto rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)] p-3 text-sm">
              <code>{s.code}</code>
            </pre>
          )}
        </section>
      ))}
    </div>
  );
}
