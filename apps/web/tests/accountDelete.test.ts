import { describe, expect, it } from "vitest";
import { ACCOUNT_DELETE_FALLBACK_PHRASE, accountDeleteConfirmPhrase, confirmMatches } from "@/lib/accountDelete";

describe("accountDeleteConfirmPhrase — 탈퇴 확인 문구", () => {
  it("이메일이 있으면 이메일 그대로", () => {
    expect(accountDeleteConfirmPhrase("me@example.com")).toBe("me@example.com");
  });

  it("이메일이 없거나 비어 있으면 고정 문구", () => {
    expect(accountDeleteConfirmPhrase(undefined)).toBe(ACCOUNT_DELETE_FALLBACK_PHRASE);
    expect(accountDeleteConfirmPhrase(null)).toBe(ACCOUNT_DELETE_FALLBACK_PHRASE);
    expect(accountDeleteConfirmPhrase("  ")).toBe(ACCOUNT_DELETE_FALLBACK_PHRASE);
  });
});

describe("confirmMatches — 입력 비교", () => {
  it("대소문자·앞뒤 공백 무시", () => {
    expect(confirmMatches("Me@Example.com", "  me@example.COM ")).toBe(true);
  });

  it("다르거나 비어 있으면 거절", () => {
    expect(confirmMatches("me@example.com", "you@example.com")).toBe(false);
    expect(confirmMatches("me@example.com", "")).toBe(false);
    expect(confirmMatches("me@example.com", null)).toBe(false);
    expect(confirmMatches("me@example.com", undefined)).toBe(false);
  });

  it("문자열이 아닌 폼 값(File)은 거절", () => {
    expect(confirmMatches("DELETE", new File([], "x") as unknown as FormDataEntryValue)).toBe(false);
  });
});
