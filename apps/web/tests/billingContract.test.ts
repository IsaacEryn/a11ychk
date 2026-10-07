import { describe, expect, it } from "vitest";
import {
  kstDateToIso,
  parseContractCreate,
  parseContractEnd,
  parseContractUpdate,
  parseSubscriptionId,
} from "../src/lib/billing/contract";

const UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SID = "11111111-2222-4333-8444-555555555555";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const base = {
  userId: UID,
  planCode: "enterprise",
  startDate: "2026-11-01",
  endDate: "2027-10-31",
  amount: "1234",
  orgName: "  예시대학교  ",
  contractRef: "",
  memo: "",
  paidDate: "",
  taxInvoiceDate: "",
};

describe("kstDateToIso", () => {
  it("시작은 그날 0시, 종료는 그날 23:59:59 (KST)", () => {
    expect(kstDateToIso("2026-11-01", "start")).toBe("2026-11-01T00:00:00+09:00");
    expect(kstDateToIso("2027-10-31", "end")).toBe("2027-10-31T23:59:59+09:00");
  });
  it("달력에 없는 날짜·형식 오류는 null", () => {
    expect(kstDateToIso("2026-02-30", "start")).toBeNull();
    expect(kstDateToIso("2026-13-01", "start")).toBeNull();
    expect(kstDateToIso("2026-1-1", "start")).toBeNull();
    expect(kstDateToIso("", "start")).toBeNull();
  });
  it("윤년 2월 29일은 허용", () => {
    expect(kstDateToIso("2028-02-29", "end")).toBe("2028-02-29T23:59:59+09:00");
  });
});

describe("parseContractCreate", () => {
  it("정상 입력 — 공백 정리, 빈 선택 항목은 null", () => {
    const r = parseContractCreate(fd(base));
    expect(r).toEqual({
      ok: true,
      value: {
        userId: UID,
        planCode: "enterprise",
        startAt: "2026-11-01T00:00:00+09:00",
        endAt: "2027-10-31T23:59:59+09:00",
        amount: 1234,
        orgName: "예시대학교",
        contractRef: null,
        memo: null,
        paidAt: null,
        taxInvoiceAt: null,
      },
    });
  });
  it("입금 확인일·세금계산서 발행일은 그날 0시로", () => {
    const r = parseContractCreate(fd({ ...base, paidDate: "2026-11-05", taxInvoiceDate: "2026-11-06" }));
    expect(r.ok && r.value.paidAt).toBe("2026-11-05T00:00:00+09:00");
    expect(r.ok && r.value.taxInvoiceAt).toBe("2026-11-06T00:00:00+09:00");
  });
  it("종료가 시작보다 앞서면 period", () => {
    expect(parseContractCreate(fd({ ...base, endDate: "2026-10-31" }))).toEqual({ ok: false, error: "period" });
  });
  it("시작과 종료가 같은 날이면 허용(하루 계약)", () => {
    expect(parseContractCreate(fd({ ...base, endDate: "2026-11-01" })).ok).toBe(true);
  });
  it.each([
    ["알 수 없는 등급", { planCode: "unlimited" }],
    ["초대 등급", { planCode: "plus2" }],
    ["사용자 id 형식", { userId: "x" }],
    ["음수 금액", { amount: "-1" }],
    ["소수 금액", { amount: "10.5" }],
    ["숫자 아닌 금액", { amount: "abc" }],
    ["기관명 없음", { orgName: "   " }],
    ["날짜 형식", { startDate: "2026/11/01" }],
    ["없는 입금일", { paidDate: "2026-02-30" }],
  ])("%s → invalid", (_name, over) => {
    expect(parseContractCreate(fd({ ...base, ...over }))).toEqual({ ok: false, error: "invalid" });
  });
});

describe("parseContractUpdate / parseContractEnd / parseSubscriptionId", () => {
  it("수정 입력", () => {
    expect(
      parseContractUpdate(fd({ subscriptionId: SID, orgName: "기관", contractRef: "K-1", memo: "메모", paidDate: "", taxInvoiceDate: "2026-11-06" })),
    ).toEqual({
      ok: true,
      value: { subscriptionId: SID, orgName: "기관", contractRef: "K-1", memo: "메모", paidAt: null, taxInvoiceAt: "2026-11-06T00:00:00+09:00" },
    });
    expect(parseContractUpdate(fd({ subscriptionId: SID, orgName: "" }))).toEqual({ ok: false, error: "invalid" });
  });
  it("종료일 변경은 그날 23:59:59", () => {
    expect(parseContractEnd(fd({ subscriptionId: SID, endDate: "2028-03-31" }))).toEqual({
      ok: true,
      value: { subscriptionId: SID, endAt: "2028-03-31T23:59:59+09:00" },
    });
    expect(parseContractEnd(fd({ subscriptionId: SID, endDate: "nope" }))).toEqual({ ok: false, error: "invalid" });
  });
  it("구독 id", () => {
    expect(parseSubscriptionId(fd({ subscriptionId: SID }))).toEqual({ ok: true, value: { subscriptionId: SID } });
    expect(parseSubscriptionId(fd({}))).toEqual({ ok: false, error: "invalid" });
  });
});
