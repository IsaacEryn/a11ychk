/**
 * 검색엔진용 구조화 데이터(schema.org JSON-LD).
 *
 * 넘기는 값은 **반드시 정적 리터럴**이어야 한다 — 사용자 입력이 섞이면 script 안에서
 * 직렬화되므로, 여기로는 코드에 박아 둔 값과 카탈로그 상수만 보낸다.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

const SITE = "https://www.a11ychk.com";

/** 사이트 전역 발행 주체 — 검색 결과의 사이트 이름·로고 근거가 된다 */
export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "A11y Check",
  alternateName: "알리첵",
  url: SITE,
  logo: `${SITE}/icon.svg`,
  description:
    "WCAG 2.2와 KWCAG 2.2를 이중 매핑한 웹접근성 자동 점검 서비스. 한국어 개선 가이드를 함께 제공한다.",
  sameAs: ["https://github.com/IsaacEryn/a11ychk"],
};

/** 검색·소개 결과에 노출되는 서비스 자체 */
export function webApplicationJsonLd(locale: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "A11y Check",
    url: SITE,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    description:
      locale === "en"
        ? "Web accessibility checker for WCAG 2.2 AA and KWCAG 2.2 (Korea's national accessibility guidelines), with Korean-language remediation guides."
        : "웹접근성 점검 도구 — WCAG 2.2와 KWCAG 2.2 기준 자동 검사, 한국어 개선 가이드가 담긴 점검 보고서.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" },
    inLanguage: ["ko", "en"],
    isAccessibleForFree: true,
  };
}

/**
 * 랜딩 FAQ — 화면에 보이는 문답과 **글자 그대로 같아야** 한다.
 * 보이지 않는 내용을 구조화 데이터에만 넣으면 구글이 스팸으로 본다.
 */
export function faqJsonLd(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
}

/** 가이드 항목 페이지의 위치 표시 — 검색 결과에 경로가 함께 나온다 */
export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${SITE}${it.url}`,
    })),
  };
}
