import { setRequestLocale } from "next-intl/server";

/**
 * 개인정보 처리방침 — 조문이 길어 messages json 대신 페이지 내 정의.
 * ※ 표준 템플릿 초안입니다. 정식 운영 전 법적 검토를 권장합니다.
 */
interface Section {
  heading: string;
  body: string[];
}

const CONTENT: Record<"ko" | "en", { title: string; effective: string; sections: Section[] }> = {
  ko: {
    title: "개인정보 처리방침",
    effective:
      "시행일: 2026년 7월 24일 (개정 — 비로그인 맛보기 검사 고지 / 2026년 7월 23일 친구 초대 기능 고지 / 2026년 7월 22일 웹 분석(GA4) 고지 / 2026년 7월 16일 제정)",
    sections: [
      {
        heading: "1. 수집하는 개인정보 항목",
        body: [
          "회원 가입 시: 이름(닉네임), 이메일 주소 — Google·GitHub 계정으로부터 제공받거나 이메일 가입 시 직접 수집합니다.",
          "서비스 이용 시: 검사 대상 URL과 검사 결과, 점검자 판정·메모, 보고서 정보(사이트 이름·평가자 등), 문의 내용.",
          "서비스 보호 목적: 로그인 기록(IP 주소 포함)과 서버 오류 로그를 수집합니다.",
          "친구 초대 기능 이용 시: 초대 코드, 피초대자 이메일의 일방향 해시값(원문은 저장하지 않음), 피초대자 가입 시점 IP 주소 — 중복·부정 초대 방지 목적으로만 사용합니다.",
          "비로그인 맛보기 검사 이용 시: 이용량 제한을 위한 IP 주소의 일방향 해시값(원본 IP는 저장하지 않으며 2일 후 자동 삭제)과, 서비스 운영 통계를 위한 검사 대상 도메인·결과 요약 수치(경로·개인 식별 정보 없음)를 수집합니다. 검사 결과 상세는 저장하지 않습니다.",
          "쿠키: 로그인 세션 유지 목적의 인증 쿠키와 서비스 이용 통계를 위한 웹 분석 쿠키(제5조)를 사용합니다. 광고 목적의 쿠키는 사용하지 않습니다.",
        ],
      },
      {
        heading: "2. 개인정보의 처리 목적",
        body: [
          "회원 식별 및 서비스 제공(검사 이력·보고서 관리), 검사 한도 등 자원 관리, 문의 응대, 정기 검사 결과 등 서비스 알림 이메일 발송(도메인별로 수신 거부 가능), 서비스 개선을 위한 통계(개인 식별 불가 형태)에 이용합니다.",
          "검사 대상 URL과 검사 결과는 개인·계정을 식별할 수 없는 집계 통계로 가공하여 학술 연구와 정책 제안에 활용될 수 있습니다. 이 경우 도메인 등 식별 요소는 제거되거나 분야 단위로 일반화됩니다.",
        ],
      },
      {
        heading: "3. 보유 및 파기",
        body: [
          "개인정보는 회원 탈퇴 시 지체 없이 파기합니다. 검사 결과 등 서비스 데이터는 탈퇴 시 함께 삭제됩니다.",
          "관련 법령에 따라 보존이 필요한 경우 해당 기간 동안 분리 보관 후 파기합니다.",
          "보안 목적으로 수집하는 로그인 기록(IP 주소 포함)과 서버 오류 로그는 90일간 보관 후 자동 삭제합니다.",
          "초대 기록의 이메일 해시값은 같은 이메일의 중복 초대를 막기 위한 목적으로 보관되며 원문 복원이 불가능합니다. 초대 기록의 가입 시점 IP 주소는 90일 후 자동 삭제합니다.",
        ],
      },
      {
        heading: "4. 처리 위탁",
        body: [
          "서비스 운영을 위해 다음 업체에 데이터 처리를 위탁합니다: Supabase(데이터베이스·인증·파일 보관), Vercel(웹 호스팅·검사 실행), Cloudflare(가입·로그인 남용 방지를 위한 보안 확인), Resend(알림 이메일 발송). 위탁 업체는 각사의 보안 기준에 따라 데이터를 처리하며, 서버가 국외에 위치할 수 있습니다.",
        ],
      },
      {
        heading: "5. 웹 분석 도구 (Google 애널리틱스)",
        body: [
          "서비스 이용 현황 파악과 개선을 위해 Google LLC의 Google 애널리틱스(GA4)를 사용합니다. 이 과정에서 쿠키를 통해 무작위 식별자가 생성되고, 방문 페이지, 접속 환경(브라우저·기기 유형), 대략적인 지역 정보가 Google 서버(국외)로 전송될 수 있습니다.",
          "수집 정보는 이용자를 직접 식별하지 않으며, 서비스 이용 통계 분석 목적 외에는 사용하지 않습니다. 브라우저의 쿠키 차단 기능 또는 Google 애널리틱스 차단 브라우저 부가기능(tools.google.com/dlpage/gaoptout)으로 수집을 거부할 수 있습니다.",
        ],
      },
      {
        heading: "6. 제3자 제공",
        body: ["법령에 의한 경우를 제외하고 개인정보를 제3자에게 제공하지 않으며, 판매하지 않습니다."],
      },
      {
        heading: "7. 이용자의 권리",
        body: [
          "이용자는 언제든지 마이페이지에서 자신의 정보를 열람·수정할 수 있으며, 탈퇴(계정 삭제)를 통해 개인정보 삭제를 요청할 수 있습니다.",
        ],
      },
      {
        heading: "8. 문의처",
        body: ["개인정보 관련 문의: isaaceryn@gmail.com 또는 서비스 내 문의하기."],
      },
    ],
  },
  en: {
    title: "Privacy Policy",
    effective:
      "Effective: July 24, 2026 (amended — no-login teaser check disclosure; July 23, 2026 referral feature; July 22, 2026 web analytics (GA4); enacted July 16, 2026)",
    sections: [
      {
        heading: "1. Data we collect",
        body: [
          "On sign-up: name (nickname) and email address — provided by your Google/GitHub account, or collected directly for email sign-up.",
          "During use: audited URLs and results, evaluator judgments/notes, report details (site name, evaluator, etc.), and inquiry contents.",
          "For service protection: sign-in records (including IP address) and server error logs.",
          "When using the referral feature: your invite code, a one-way hash of the invitee's email (the original is not stored), and the invitee's IP address at sign-up — used only to prevent duplicate or fraudulent referrals.",
          "When using the no-login teaser check: a one-way hash of your IP address for rate limiting (the original IP is not stored; deleted automatically after 2 days), and the checked domain with summary result figures for service statistics (no paths or personally identifiable information). Detailed results are not stored.",
          "Cookies: authentication cookies for session management, plus web-analytics cookies for usage statistics (see Section 5). No advertising cookies.",
        ],
      },
      {
        heading: "2. Purposes",
        body: [
          "Identifying members and providing the service (audit history and reports), resource management such as quotas, responding to inquiries, sending service notification emails such as scheduled audit results (opt-out per domain), and non-identifying statistics for service improvement.",
          "Audit target URLs and results may be processed into aggregate statistics that cannot identify any user or account, and used for academic research and policy proposals. Identifying elements such as domains are removed or generalized into categories.",
        ],
      },
      {
        heading: "3. Retention & deletion",
        body: [
          "Personal data is deleted without delay upon account deletion, together with service data such as audit results. Data required by law is stored separately for the mandated period, then destroyed.",
          "Sign-in records collected for security (including IP addresses) and server error logs are kept for 90 days and then deleted automatically.",
          "Email hashes in referral records are retained to prevent duplicate referrals of the same email and cannot be reversed. Sign-up IP addresses in referral records are deleted automatically after 90 days.",
        ],
      },
      {
        heading: "4. Processors",
        body: [
          "We entrust processing to: Supabase (database, authentication, file storage), Vercel (hosting, audit execution), Cloudflare (abuse-prevention checks at sign-up/sign-in), and Resend (notification emails), each under their own security standards. Their servers may be located outside Korea.",
        ],
      },
      {
        heading: "5. Web analytics (Google Analytics)",
        body: [
          "We use Google Analytics (GA4) by Google LLC to understand and improve how the service is used. Cookies generate a random identifier, and visited pages, browsing environment (browser/device type), and approximate region may be transmitted to Google servers (outside Korea).",
          "This data does not directly identify you and is used only for usage statistics. You can opt out by blocking cookies in your browser or with the Google Analytics opt-out add-on (tools.google.com/dlpage/gaoptout).",
        ],
      },
      {
        heading: "6. Third parties",
        body: ["We do not provide or sell personal data to third parties except as required by law."],
      },
      {
        heading: "7. Your rights",
        body: [
          "You can view and edit your information on My Page at any time, and request deletion by deleting your account.",
        ],
      },
      {
        heading: "8. Contact",
        body: ["Privacy inquiries: isaaceryn@gmail.com or the in-service support page."],
      },
    ],
  },
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return { title: CONTENT[locale === "en" ? "en" : "ko"].title };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
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
