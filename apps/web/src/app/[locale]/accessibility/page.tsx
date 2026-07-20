import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * 접근성 선언문 — 서비스 자체의 접근성 준수 약속과 점검 방식을 공개한다.
 * 조문형 정적 콘텐츠라 terms/privacy와 같은 페이지 내 정의 패턴을 사용.
 */

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return {
    title: locale === "en" ? "Accessibility Statement" : "접근성 선언문",
    description:
      locale === "en"
        ? "A11y Check's commitment to WCAG 2.2 AA and KWCAG 2.2 conformance."
        : "A11y Check의 WCAG 2.2 AA·KWCAG 2.2 준수 약속과 자체 점검 방식.",
  };
}

interface Section {
  heading: string;
  body: string[];
}

const CONTENT: Record<"ko" | "en", { title: string; intro: string; updated: string; sections: Section[]; contact: string }> = {
  ko: {
    title: "접근성 선언문",
    intro:
      "A11y Check는 모든 사용자가 장애 유무와 관계없이 동등하게 서비스를 이용할 수 있어야 한다고 믿습니다. 접근성 점검 서비스로서, 우리는 우리가 요구하는 기준을 우리 자신에게 가장 먼저 적용합니다.",
    updated: "최종 갱신: 2026년 7월 16일",
    sections: [
      {
        heading: "준수 목표",
        body: [
          "본 서비스는 W3C 웹 콘텐츠 접근성 지침(WCAG) 2.2 AA 수준과 한국형 웹 콘텐츠 접근성 지침(KWCAG) 2.2를 준수하는 것을 목표로 설계·개발되었습니다.",
          "시맨틱 마크업, 키보드 조작 보장, 보이는 초점 표시, 4.5:1 이상의 명도 대비(모든 색 토큰 검증), 상태 변화의 스크린리더 안내(aria-live)를 기본 원칙으로 합니다.",
        ],
      },
      {
        heading: "지원 환경",
        body: [
          "NVDA + Chrome (Windows), VoiceOver + Safari (macOS/iOS), 센스리더 + Chrome (Windows), TalkBack + Chrome (Android) 조합에서의 이용을 기준으로 점검합니다.",
          "라이트·다크·고대비 테마와 400% 확대(320px 리플로우)를 지원합니다.",
        ],
      },
      {
        heading: "자체 점검 방식",
        body: [
          "본 서비스는 자사 검사 엔진(axe-core 기반 + 자체 규칙)으로 서비스 자신을 정기적으로 점검합니다.",
          "새 기능을 배포할 때마다 자동 검사를 수행하고, 자동화가 불가능한 항목은 점검자가 직접 확인합니다.",
        ],
      },
      {
        heading: "알려진 제한사항",
        body: [
          "검사 대상 사이트에서 수집한 위반 HTML 코드 조각은 원문 그대로 표시되므로, 해당 조각 자체의 접근성 품질은 보장되지 않습니다.",
          "PDF 내보내기는 인쇄 최적화 문서로, 태그드 PDF(PDF/UA)는 아직 지원하지 않습니다. 스크린리더 이용 시 웹 보고서 화면을 권장합니다.",
        ],
      },
    ],
    contact: "접근성 문제를 발견하셨나요? 문의하기로 알려주시면 우선순위로 개선하겠습니다.",
  },
  en: {
    title: "Accessibility Statement",
    intro:
      "A11y Check believes every user deserves equal access, regardless of disability. As an accessibility audit service, we hold ourselves to the same standards we measure others against — first.",
    updated: "Last updated: July 16, 2026",
    sections: [
      {
        heading: "Conformance goal",
        body: [
          "This service is designed and built to conform to W3C Web Content Accessibility Guidelines (WCAG) 2.2 Level AA and the Korean Web Content Accessibility Guidelines (KWCAG) 2.2.",
          "Core principles: semantic markup, full keyboard operability, visible focus indicators, minimum 4.5:1 contrast (all color tokens verified), and screen-reader announcements for state changes (aria-live).",
        ],
      },
      {
        heading: "Supported environments",
        body: [
          "We test with NVDA + Chrome (Windows), VoiceOver + Safari (macOS/iOS), Sense Reader + Chrome (Windows), and TalkBack + Chrome (Android).",
          "Light, dark, and high-contrast themes are supported, along with 400% zoom (320px reflow).",
        ],
      },
      {
        heading: "How we audit ourselves",
        body: [
          "This service is regularly audited with our own scan engine (axe-core plus custom rules).",
          "Every deployment runs automated checks; items that cannot be automated are verified manually by an evaluator.",
        ],
      },
      {
        heading: "Known limitations",
        body: [
          "HTML snippets collected from audited sites are shown verbatim, so the accessibility of those snippets themselves is not guaranteed.",
          "PDF export is a print-optimized document and does not yet support tagged PDF (PDF/UA). Screen-reader users are encouraged to use the web report view.",
        ],
      },
    ],
    contact: "Found an accessibility issue? Let us know via the contact page and we will prioritize a fix.",
  },
};

export default async function AccessibilityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const c = CONTENT[locale === "en" ? "en" : "ko"];

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="font-display text-3xl font-extrabold">{c.title}</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-faint)]">{c.updated}</p>
      <p className="mt-6 text-lg leading-relaxed text-[var(--color-ink-soft)]">{c.intro}</p>

      {c.sections.map((s) => (
        <section key={s.heading} className="mt-10" aria-labelledby={`a11y-${s.heading}`}>
          <h2 id={`a11y-${s.heading}`} className="font-display text-xl font-bold">
            {s.heading}
          </h2>
          {s.body.map((p, i) => (
            <p key={i} className="mt-3 leading-relaxed text-[var(--color-ink-soft)]">
              {p}
            </p>
          ))}
        </section>
      ))}

      <p className="mt-12 border-t-[1.5px] border-[var(--color-line)] pt-6">
        <Link href="/inquiries" className="font-bold text-[var(--color-seal)] underline underline-offset-4">
          {c.contact}
        </Link>
      </p>
    </div>
  );
}
