import { setRequestLocale } from "next-intl/server";

/**
 * 서비스 이용약관 — 조문이 길어 messages json 대신 페이지 내 정의.
 * ※ 표준 템플릿 초안입니다. 정식 운영 전 법적 검토를 권장합니다.
 */
interface Section {
  heading: string;
  body: string[];
}

const CONTENT: Record<"ko" | "en", { title: string; effective: string; sections: Section[] }> = {
  ko: {
    title: "서비스 이용약관",
    effective: "시행일: 2026년 7월 19일 (2026년 7월 16일 제정 — 비식별 데이터 활용 조항 신설, 서비스 내용 구체화)",
    sections: [
      {
        heading: "제1조 (목적)",
        body: [
          "이 약관은 A11Y Check(이하 \"서비스\")가 제공하는 웹 접근성 자동 점검 및 평가 보고서 서비스의 이용 조건과 절차, 이용자와 운영자의 권리·의무를 규정함을 목적으로 합니다.",
        ],
      },
      {
        heading: "제2조 (정의)",
        body: [
          "\"서비스\"란 a11ychk.com에서 제공하는 웹 접근성 자동 검사, 평가 보고서 작성, 크롬 확장, 접근성 배지 등 일체의 기능을 말합니다.",
          "\"이용자\"란 이 약관에 따라 서비스를 이용하는 회원을 말합니다.",
        ],
      },
      {
        heading: "제3조 (서비스의 내용)",
        body: [
          "서비스는 이용자가 입력한 공개 웹페이지를 자동 도구(axe-core)로 검사하고 WCAG 2.2·KWCAG 2.2 기준의 보고서를 생성합니다.",
          "서비스는 robots.txt 등 대상 사이트의 크롤링 정책을 존중하며, 정책상 차단된 페이지는 검사하지 않습니다.",
          "이용자가 소유 확인한 도메인에 대해 정기 자동 검사와 결과 알림을 제공할 수 있습니다.",
          "이용자가 보고서 공유 링크를 생성하면 링크를 아는 누구나 해당 보고서를 열람할 수 있습니다. 공유 링크의 전달·해제 관리 책임은 이용자에게 있습니다.",
          "무료 서비스의 검사 횟수·표본 크기는 운영 사정에 따라 제한될 수 있습니다.",
        ],
      },
      {
        heading: "제4조 (계정)",
        body: [
          "서비스 이용을 위해 Google·GitHub 계정 또는 이메일을 통한 로그인이 필요합니다.",
          "이용자는 타인의 계정을 도용하거나 운영자·관리자를 사칭하는 닉네임을 사용할 수 없습니다.",
        ],
      },
      {
        heading: "제5조 (이용 제한)",
        body: [
          "다음의 경우 서비스 이용이 제한될 수 있습니다: ① 검사 한도를 우회하려는 시도 ② 타인 소유 사이트에 대한 악의적 대량 검사 ③ 서비스의 정상 운영을 방해하는 행위.",
          "운영자는 위반 계정에 대해 사전 통지 없이 이용을 제한할 수 있습니다.",
        ],
      },
      {
        heading: "제6조 (자동 검사의 한계와 면책)",
        body: [
          "자동 검사는 웹 접근성 문제의 일부만 검출할 수 있으며, 보고서의 결과는 접근성 적합성(준수)을 보증하지 않습니다.",
          "공식 인증(웹 접근성 품질인증 마크 등)에는 전문가의 수동 심사가 필요합니다.",
          "서비스는 보고서 활용으로 발생한 손해에 대해 고의 또는 중대한 과실이 없는 한 책임을 지지 않습니다.",
        ],
      },
      {
        heading: "제7조 (비식별 데이터의 활용)",
        body: [
          "운영자는 검사 대상 URL과 검사 결과를 개인·계정을 식별할 수 없는 형태로 가공하여 서비스 개선, 통계 작성, 학술 연구 및 정책 제안에 활용할 수 있습니다.",
          "이 경우 특정 이용자나 특정 웹사이트가 드러나지 않도록 도메인 등 식별 요소를 제거하거나 분야 단위로 분류한 집계 통계만 사용합니다.",
        ],
      },
      {
        heading: "제8조 (오픈소스)",
        body: [
          "서비스의 검사 엔진과 규칙 카탈로그는 MIT 라이선스로 공개되어 있으며, 라이선스 조건에 따라 자유롭게 이용할 수 있습니다.",
        ],
      },
      {
        heading: "제9조 (약관의 변경)",
        body: [
          "운영자는 필요 시 약관을 변경할 수 있으며, 변경 사항은 서비스 내 공지로 효력이 발생합니다. 변경에 동의하지 않는 이용자는 서비스 이용을 중단하고 탈퇴할 수 있습니다.",
        ],
      },
    ],
  },
  en: {
    title: "Terms of Service",
    effective: "Effective: July 19, 2026 (enacted July 16, 2026; de-identified data clause added, service details clarified)",
    sections: [
      {
        heading: "1. Purpose",
        body: [
          "These terms govern the use of A11Y Check (the \"Service\"), a web accessibility automated audit and evaluation reporting service, and define the rights and obligations of users and the operator.",
        ],
      },
      {
        heading: "2. The Service",
        body: [
          "The Service audits publicly accessible web pages submitted by the user with automated tooling (axe-core) and produces reports based on WCAG 2.2 and KWCAG 2.2.",
          "The Service respects target sites' crawling policies (robots.txt); pages disallowed by policy are not audited.",
          "Scheduled automatic audits and result notifications may be provided for domains the user has verified.",
          "If the user creates a report share link, anyone with the link can view that report. Managing and revoking share links is the user's responsibility.",
          "Audit quotas and sample sizes of the free service may be limited at the operator's discretion.",
        ],
      },
      {
        heading: "3. Accounts",
        body: [
          "Sign-in via Google, GitHub, or email is required. Users must not impersonate operators/administrators or use another person's account.",
        ],
      },
      {
        heading: "4. Restrictions",
        body: [
          "Use may be restricted for: attempts to bypass quotas, malicious bulk audits of third-party sites, or conduct that disrupts the Service.",
        ],
      },
      {
        heading: "5. Limits of automated testing & disclaimer",
        body: [
          "Automated audits detect only a subset of accessibility issues; reports do not guarantee conformance. Official certification requires expert manual review.",
          "The Service is not liable for damages arising from use of reports except in cases of intent or gross negligence.",
        ],
      },
      {
        heading: "6. De-identified data",
        body: [
          "The operator may process audit target URLs and audit results into a form that cannot identify any user or account, and use them for service improvement, statistics, academic research, and policy proposals.",
          "Only aggregate statistics are used in such cases, with identifying elements (such as domains) removed or generalized into categories, so that no specific user or website is exposed.",
        ],
      },
      {
        heading: "7. Open source",
        body: ["The audit engine and rule catalog are published under the MIT license."],
      },
      {
        heading: "8. Changes",
        body: [
          "The operator may amend these terms; changes take effect upon notice within the Service. Users who do not agree may discontinue use and delete their account.",
        ],
      },
    ],
  },
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return { title: CONTENT[locale === "en" ? "en" : "ko"].title };
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const c = CONTENT[locale === "en" ? "en" : "ko"];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-bold">{c.title}</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-faint)]">{c.effective}</p>
      {c.sections.map((s) => (
        <section key={s.heading} className="mt-8">
          <h2 className="font-display text-xl font-bold">{s.heading}</h2>
          {s.body.map((p, i) => (
            <p key={i} className="mt-2 leading-relaxed text-[var(--color-ink-soft)]">
              {p}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
