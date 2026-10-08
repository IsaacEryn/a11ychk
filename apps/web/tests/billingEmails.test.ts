import { describe, expect, it } from "vitest";
import { buildBillingEmail } from "../src/lib/billing/emails";

const ko = { locale: "ko" as const, test: false };

describe("결제 메일", () => {
  it("영수증: 금액·다음 결제일·영수증 링크·해지 경로", () => {
    const { subject, html } = buildBillingEmail(
      "receipt",
      { planName: "Pro", amount: 1234, currency: "KRW", periodEnd: "2026-11-15T01:00:00.000Z", receiptUrl: "https://r.example/1", card: "신용 1234****", manageUrl: "https://a.example/ko/mypage/billing" },
      ko,
    );
    expect(subject).toContain("Pro");
    expect(html).toContain("1,234");
    expect(html).toContain("https://r.example/1");
    expect(html).toContain("https://a.example/ko/mypage/billing");
  });
  it("테스트 모드는 제목 앞에 [TEST]", () => {
    expect(buildBillingEmail("cancelScheduled", { planName: "Pro", endsAt: "2026-11-15T01:00:00.000Z", manageUrl: "https://a" }, { locale: "en", test: true }).subject.startsWith("[TEST] ")).toBe(true);
  });
  it("결제 실패: 카드 변경이 필요하면 그렇게 안내하고 유예 기한을 알린다", () => {
    const { html } = buildBillingEmail(
      "failed",
      { planName: "Pro", amount: 1234, currency: "KRW", graceUntil: "2026-11-22T01:00:00.000Z", needsCardChange: true, manageUrl: "https://a" },
      ko,
    );
    expect(html).toMatch(/카드/);
    expect(html).toMatch(/2026/);
  });
  it("사용자 값은 HTML 이스케이프된다", () => {
    const { html } = buildBillingEmail("ended", { planName: "<b>x</b>", reason: "canceled", pricingUrl: "https://a" }, ko);
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("영수증과 결제 예정 안내 본문에 해지 경로가 있다", () => {
    const receipt = buildBillingEmail(
      "receipt",
      { planName: "Pro", amount: 1234, currency: "KRW", periodEnd: "2026-11-15T01:00:00.000Z", receiptUrl: null, card: null, manageUrl: "https://a.example/billing" },
      ko,
    );
    expect(receipt.html).toContain("마이페이지 → 결제 관리에서 언제든 해지할 수 있어요.");
    // 안내 문장은 작은 회색 주석이 아니라 일반 본문 크기로 나온다
    expect(receipt.html).toMatch(/font-size:14px[^>]*>마이페이지 → 결제 관리에서 언제든 해지/);
    const reminder = buildBillingEmail(
      "reminder",
      { planName: "Pro", amount: 1234, currency: "KRW", chargeAt: "2026-11-15T01:00:00.000Z", manageUrl: "https://a.example/billing" },
      ko,
    );
    expect(reminder.html).toContain("해지");
    expect(reminder.html).toContain("2026년 11월 15일에 ₩1,234 결제가 예정돼 있어요.");
  });
  it("영수증 링크와 카드 줄은 값이 없으면 나오지 않는다", () => {
    const { html } = buildBillingEmail(
      "receipt",
      { planName: "Pro", amount: 1234, currency: "KRW", periodEnd: "2026-11-15T01:00:00.000Z", receiptUrl: null, card: null, manageUrl: "https://a.example/billing" },
      ko,
    );
    expect(html).not.toContain("영수증 보기");
    expect(html).not.toContain("결제 카드");
  });
  it("javascript: 같은 http(s)가 아닌 주소는 링크로 내지 않는다", () => {
    const { html } = buildBillingEmail(
      "receipt",
      { planName: "Pro", amount: 1234, currency: "KRW", periodEnd: "2026-11-15T01:00:00.000Z", receiptUrl: "javascript:alert(1)", card: null, manageUrl: "https://a.example/billing" },
      ko,
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("영수증 보기");
    expect(html).toContain("https://a.example/billing");
  });
  it("버튼 주소도 http(s)가 아니면 버튼을 빼고 보낸다", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", ""]) {
      const { html } = buildBillingEmail("cancelScheduled", { planName: "Pro", endsAt: "2026-11-15T01:00:00.000Z", manageUrl: bad }, ko);
      expect(html).not.toContain("javascript:");
      expect(html).not.toContain("data:text");
      expect(html).not.toContain("evil.example");
      expect(html).not.toContain("결제 관리</a>");
    }
    const ended = buildBillingEmail("ended", { planName: "Pro", reason: "canceled", pricingUrl: "javascript:alert(1)" }, ko);
    expect(ended.html).not.toContain("javascript:");
  });
  it("주소의 따옴표·앰퍼샌드는 속성 안에서 이스케이프된다", () => {
    const { html } = buildBillingEmail("cancelScheduled", { planName: "Pro", endsAt: "2026-11-15T01:00:00.000Z", manageUrl: 'https://a.example/b?x=1&y="2"' }, ko);
    expect(html).toContain('href="https://a.example/b?x=1&amp;y=&quot;2&quot;"');
  });
  it("날짜 문자열이 잘못돼도 던지지 않고 원문을 보여준다", () => {
    const build = () =>
      buildBillingEmail("failed", { planName: "Pro", amount: 1234, currency: "KRW", graceUntil: "not-a-date", needsCardChange: false, manageUrl: "https://a" }, ko);
    expect(build).not.toThrow();
    expect(build().html).toContain("not-a-date");
  });
  it("알 수 없는 통화 코드여도 던지지 않는다", () => {
    const build = () =>
      buildBillingEmail(
        "receipt",
        { planName: "Pro", amount: 1234, currency: "NOT_A_CURRENCY", periodEnd: "2026-11-15T01:00:00.000Z", receiptUrl: null, card: null, manageUrl: "https://a" },
        ko,
      );
    expect(build).not.toThrow();
    expect(build().html).toContain("1234 NOT_A_CURRENCY");
  });
  it("테스트 모드는 본문 맨 위에 안내 한 줄을 넣고, 실결제 모드는 넣지 않는다", () => {
    const data = { planName: "Pro", endsAt: "2026-11-15T01:00:00.000Z", manageUrl: "https://a" };
    const koTest = buildBillingEmail("cancelScheduled", data, { locale: "ko", test: true });
    expect(koTest.html).toContain("테스트 결제입니다 — 실제로 청구되지 않습니다.");
    expect(koTest.html.indexOf("테스트 결제입니다")).toBeLessThan(koTest.html.indexOf("해지가 예약됐어요"));
    const enTest = buildBillingEmail("cancelScheduled", data, { locale: "en", test: true });
    expect(enTest.html).toContain("This is a test payment — no money was charged.");
    expect(buildBillingEmail("cancelScheduled", data, ko).html).not.toContain("테스트 결제입니다");
    expect(buildBillingEmail("cancelScheduled", data, ko).subject).not.toContain("[TEST]");
  });
  it("종료 메일: 해지 예약과 미결제는 사유 문구가 다르다", () => {
    const canceled = buildBillingEmail("ended", { planName: "Pro", reason: "canceled", pricingUrl: "https://a.example/ko/pricing" }, ko);
    expect(canceled.html).toContain("해지 예약에 따라 Pro 구독이 끝났어요.");
    expect(canceled.html).toContain("https://a.example/ko/pricing");
    const unpaid = buildBillingEmail("ended", { planName: "Pro", reason: "unpaid", pricingUrl: "https://a.example/ko/pricing" }, ko);
    expect(unpaid.html).toContain("결제가 이뤄지지 않아 Pro 구독이 끝났어요.");
    expect(unpaid.html).not.toContain("해지 예약에 따라");
    expect(unpaid.subject).toBe("A11y Check Pro 구독이 끝났어요");
  });
  it("종료 메일: 사용자가 바로 해지했으면 예약 문구가 아니라 바로 해지 문구(미납액 면제 같은 말은 없다)", () => {
    const now = buildBillingEmail("ended", { planName: "Pro", reason: "canceledNow", pricingUrl: "https://a.example/ko/pricing" }, ko);
    expect(now.html).toContain("요청하신 대로 Pro 구독을 바로 해지했어요. 앞으로 결제되지 않아요.");
    expect(now.html).not.toContain("해지 예약에 따라");
    expect(now.html).not.toContain("결제가 이뤄지지 않아");
    expect(now.subject).toBe("A11y Check Pro 구독이 끝났어요");
    const en = buildBillingEmail("ended", { planName: "Pro", reason: "canceledNow", pricingUrl: "https://a.example/en/pricing" }, { locale: "en", test: false });
    expect(en.html).toContain("As you requested");
    expect(en.html).toContain("Pro subscription right away");
    expect(en.html).not.toContain("As scheduled");
  });
  it("결제 실패: 횟수를 암시하지 않고, 재시도 안내는 카드 변경이 필요 없을 때만", () => {
    const base = { planName: "Pro", amount: 1234, currency: "KRW", graceUntil: "2026-11-22T01:00:00.000Z", manageUrl: "https://a" };
    const retry = buildBillingEmail("failed", { ...base, needsCardChange: false }, ko).html;
    expect(retry).toContain("이번 카드 결제가 실패했어요.");
    expect(retry).toContain("며칠 뒤 다시 시도해요");
    expect(retry).not.toContain("한 번");
    const change = buildBillingEmail("failed", { ...base, needsCardChange: true }, ko).html;
    expect(change).toContain("이번 카드 결제가 실패했어요.");
    expect(change).toContain("카드를 바꿔 주세요");
    expect(change).not.toContain("다시 시도");
    expect(change).toContain("2026년 11월 22일까지 결제되지 않으면 구독이 끝나요.");
    const enRetry = buildBillingEmail("failed", { ...base, needsCardChange: false }, { locale: "en", test: false }).html;
    expect(enRetry).toContain("This card payment didn't go through.");
    expect(enRetry).toContain("We'll try again in a few days.");
  });
});
