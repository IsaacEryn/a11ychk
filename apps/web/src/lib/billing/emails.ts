import "server-only";
import { EMAIL, emailButton, emailCard, escapeHtml, sendEmail } from "@/lib/notify";

/**
 * 결제 안내 메일 — 영수증·결제 실패·결제 예정·해지 예약·구독 종료.
 * 문구는 notify.ts의 관례대로 messages JSON이 아니라 코드에 둔다(메일은 서버가 locale을 정해 보낸다).
 * 빌더는 순수 함수라 발송 없이 검증하고, 사용자·결제사에서 온 값은 render 한 곳에서만 이스케이프한다.
 */

export interface BillingEmailData {
  receipt: {
    planName: string;
    amount: number;
    currency: string;
    /** 이번 결제로 이용하게 된 기간의 끝 = 다음 결제일 */
    periodEnd: string;
    receiptUrl: string | null;
    /** 이미 마스킹된 카드 요약(예: "신용 1234****") */
    card: string | null;
    manageUrl: string;
  };
  failed: {
    planName: string;
    amount: number;
    currency: string;
    graceUntil: string;
    needsCardChange: boolean;
    manageUrl: string;
  };
  reminder: {
    planName: string;
    amount: number;
    currency: string;
    chargeAt: string;
    manageUrl: string;
  };
  cancelScheduled: {
    planName: string;
    endsAt: string;
    manageUrl: string;
  };
  ended: {
    planName: string;
    reason: "canceled" | "unpaid";
    pricingUrl: string;
  };
}

export type BillingEmailKind = keyof BillingEmailData;

export interface BillingEmailOpts {
  locale: "ko" | "en";
  /** 결제사 테스트 모드 — 제목에 [TEST], 본문 맨 위에 안내 한 줄 */
  test: boolean;
}

interface Fmt {
  en: boolean;
  /** locale에 맞는 문구 고르기 */
  t: (ko: string, en: string) => string;
  money: (amount: number, currency: string) => string;
  date: (iso: string) => string;
}

/** 본문 조각 — 모든 문자열은 평문이고 render가 이스케이프한다 */
interface Draft {
  subject: string;
  heading: string;
  paragraphs: string[];
  details?: Array<[label: string, value: string]>;
  link?: { href: string; label: string };
  button: { href: string; label: string };
  note?: string;
}

function makeFmt(locale: "ko" | "en"): Fmt {
  const en = locale === "en";
  const tag = en ? "en-US" : "ko-KR";
  const dateFormat = new Intl.DateTimeFormat(tag, { dateStyle: "long", timeZone: "Asia/Seoul" });
  return {
    en,
    t: (ko, enText) => (en ? enText : ko),
    money(amount, currency) {
      try {
        return new Intl.NumberFormat(tag, { style: "currency", currency }).format(amount);
      } catch {
        // 알 수 없는 통화 코드 — 메일을 못 보내는 것보다 덜 예쁜 금액이 낫다
        return `${amount} ${currency}`;
      }
    },
    date(iso) {
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? iso : dateFormat.format(d);
    },
  };
}

/** 외부(결제사)에서 온 링크는 http(s)만 쓴다 */
function httpUrl(u: string | null): string | null {
  return u && /^https?:\/\//i.test(u) ? u : null;
}

const BUILDERS: { [K in BillingEmailKind]: (d: BillingEmailData[K], f: Fmt) => Draft } = {
  receipt(d, f) {
    const receiptUrl = httpUrl(d.receiptUrl);
    return {
      subject: f.t(`A11y Check ${d.planName} 결제가 완료됐어요`, `Your A11y Check ${d.planName} payment is complete`),
      heading: f.t("결제가 완료됐어요", "Your payment is complete"),
      paragraphs: [
        f.t(
          `${d.planName} 구독 결제가 정상적으로 처리됐어요.`,
          `We've processed your ${d.planName} subscription payment.`,
        ),
      ],
      details: [
        [f.t("요금제", "Plan"), d.planName],
        [f.t("결제 금액 (부가세 포함)", "Amount paid (VAT included)"), f.money(d.amount, d.currency)],
        ...(d.card ? ([[f.t("결제 카드", "Card"), d.card]] as Array<[string, string]>) : []),
        [f.t("다음 결제일", "Next payment"), f.date(d.periodEnd)],
      ],
      link: receiptUrl ? { href: receiptUrl, label: f.t("영수증 보기", "View receipt") } : undefined,
      button: { href: d.manageUrl, label: f.t("결제 관리", "Manage billing") },
      note: f.t(
        "해지하려면 마이페이지 → 결제 관리에서 언제든 할 수 있어요.",
        "To cancel, go to My page → Billing at any time.",
      ),
    };
  },

  failed(d, f) {
    return {
      subject: f.t(`A11y Check ${d.planName} 결제에 실패했어요`, `Your A11y Check ${d.planName} payment failed`),
      heading: f.t("결제에 실패했어요", "Your payment failed"),
      paragraphs: [
        d.needsCardChange
          ? f.t(
              "등록한 카드로 결제할 수 없어요. 결제 관리에서 카드를 바꿔 주세요.",
              "We couldn't charge the card on file. Please change your card under Billing.",
            )
          : f.t(
              "카드 결제가 한 번 실패했어요. 며칠 뒤 다시 시도해요.",
              "The card payment didn't go through. We'll try again in a few days.",
            ),
        f.t(
          `${f.date(d.graceUntil)}까지 결제되지 않으면 구독이 끝나요.`,
          `If the payment still hasn't gone through by ${f.date(d.graceUntil)}, your subscription will end.`,
        ),
      ],
      details: [
        [f.t("요금제", "Plan"), d.planName],
        [f.t("결제 금액 (부가세 포함)", "Amount due (VAT included)"), f.money(d.amount, d.currency)],
      ],
      button: { href: d.manageUrl, label: f.t("결제 관리", "Manage billing") },
    };
  },

  reminder(d, f) {
    return {
      subject: f.t(`A11y Check ${d.planName} 정기결제 예정 안내`, `Upcoming A11y Check ${d.planName} renewal`),
      heading: f.t("정기결제가 곧 진행돼요", "Your renewal is coming up"),
      paragraphs: [
        f.t(
          `${f.date(d.chargeAt)}에 ${f.money(d.amount, d.currency)} 결제가 예정돼 있어요.`,
          `A payment of ${f.money(d.amount, d.currency)} is scheduled for ${f.date(d.chargeAt)}.`,
        ),
        f.t(
          "계속 이용하지 않을 거라면 결제일 전에 마이페이지 → 결제 관리에서 해지해 주세요.",
          "If you don't want to continue, cancel under My page → Billing before that date.",
        ),
      ],
      details: [
        [f.t("요금제", "Plan"), d.planName],
        [f.t("결제 예정일", "Payment date"), f.date(d.chargeAt)],
        [f.t("결제 금액 (부가세 포함)", "Amount (VAT included)"), f.money(d.amount, d.currency)],
      ],
      button: { href: d.manageUrl, label: f.t("결제 관리", "Manage billing") },
    };
  },

  cancelScheduled(d, f) {
    return {
      subject: f.t(`A11y Check ${d.planName} 해지가 예약됐어요`, `Your A11y Check ${d.planName} cancellation is scheduled`),
      heading: f.t("해지가 예약됐어요", "Your cancellation is scheduled"),
      paragraphs: [
        f.t(
          `${f.date(d.endsAt)}까지 이용할 수 있고 그 뒤로는 결제되지 않아요.`,
          `You can keep using ${d.planName} until ${f.date(d.endsAt)}, and you won't be charged after that.`,
        ),
        f.t(
          "마음이 바뀌면 그 전에 해지를 취소할 수 있어요.",
          "If you change your mind, you can undo the cancellation before then.",
        ),
      ],
      button: { href: d.manageUrl, label: f.t("결제 관리", "Manage billing") },
    };
  },

  ended(d, f) {
    return {
      subject: f.t(`A11y Check ${d.planName} 구독이 끝났어요`, `Your A11y Check ${d.planName} subscription has ended`),
      heading: f.t("구독이 끝났어요", "Your subscription has ended"),
      paragraphs: [
        d.reason === "canceled"
          ? f.t(
              `해지 예약에 따라 ${d.planName} 구독이 끝났어요.`,
              `As scheduled, your ${d.planName} subscription has ended.`,
            )
          : f.t(
              `결제가 이뤄지지 않아 ${d.planName} 구독이 끝났어요.`,
              `Your ${d.planName} subscription has ended because the payment didn't go through.`,
            ),
        f.t("언제든 요금제 보기에서 다시 구독할 수 있어요.", "You can subscribe again anytime from the pricing page."),
      ],
      button: { href: d.pricingUrl, label: f.t("요금제 보기", "View plans") },
    };
  },
};

function renderDetails(items: Array<[string, string]>): string {
  const cell = `padding:8px 0;border-bottom:1px solid ${EMAIL.line}`;
  const rows = items
    .map(
      ([label, value]) =>
        `<tr><td style="${cell};width:42%;font-size:13px;color:${EMAIL.inkSoft}">${escapeHtml(label)}</td><td style="${cell};font-size:14px">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0;border-top:1px solid ${EMAIL.line}">${rows}</table>`;
}

function render(draft: Draft, f: Fmt, test: boolean): string {
  const banner = test
    ? `
      <tr><td style="padding:8px 32px 0">
        <p style="margin:0;padding:8px 12px;border:1px solid ${EMAIL.crit};border-radius:6px;font-size:13px;font-weight:700;color:${EMAIL.crit}">${escapeHtml(
          f.t("테스트 결제입니다 — 실제로 청구되지 않습니다.", "This is a test payment — no money was charged."),
        )}</p>
      </td></tr>`
    : "";
  const paragraphs = draft.paragraphs
    .map((p) => `<p style="margin:12px 0 0;font-size:14px;line-height:1.6">${escapeHtml(p)}</p>`)
    .join("");
  const details = draft.details ? renderDetails(draft.details) : "";
  const link = draft.link
    ? `<p style="margin:14px 0 0;font-size:14px"><a href="${escapeHtml(draft.link.href)}" style="color:${EMAIL.seal};font-weight:700">${escapeHtml(draft.link.label)}</a></p>`
    : "";
  const note = draft.note
    ? `<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${EMAIL.inkSoft}">${escapeHtml(draft.note)}</p>`
    : "";
  return emailCard(`${banner}
      <tr><td style="padding:8px 32px">
        <p style="margin:0;font-size:16px;font-weight:700">${escapeHtml(draft.heading)}</p>
        ${paragraphs}
        ${details}
        ${link}
      </td></tr>
      <tr><td style="padding:20px 32px 28px">
        ${emailButton(escapeHtml(draft.button.href), escapeHtml(draft.button.label))}
        ${note}
      </td></tr>`);
}

/** 순수 빌더 — 발송하지 않는다. 테스트 모드면 제목에 [TEST], 본문 맨 위에 안내 한 줄 */
export function buildBillingEmail<K extends BillingEmailKind>(
  kind: K,
  data: BillingEmailData[K],
  opts: BillingEmailOpts,
): { subject: string; html: string } {
  const f = makeFmt(opts.locale);
  const build = BUILDERS[kind];
  const draft = build(data, f);
  return {
    subject: `${opts.test ? "[TEST] " : ""}${draft.subject}`,
    html: render(draft, f, opts.test),
  };
}

/** best-effort — RESEND_API_KEY가 없거나 발송이 실패하면 false. 실패 기록은 호출부가 남긴다 */
export async function sendBillingEmail<K extends BillingEmailKind>(
  to: string,
  kind: K,
  data: BillingEmailData[K],
  opts: BillingEmailOpts,
): Promise<boolean> {
  const { subject, html } = buildBillingEmail(kind, data, opts);
  return sendEmail({ to, subject, html });
}
