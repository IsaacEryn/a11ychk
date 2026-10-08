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
});
