/**
 * 회원 탈퇴 확인 문구 — 서버 액션과 확인 폼이 같은 규칙을 쓴다(클라이언트에서도 import 가능한 순수 함수).
 * 계정 이메일을 그대로 입력하게 해 실수·다른 계정 착각을 막는다. 이메일이 없는 계정(일부 OAuth)은 고정 문구.
 */
export const ACCOUNT_DELETE_FALLBACK_PHRASE = "DELETE";

export function accountDeleteConfirmPhrase(email: string | null | undefined): string {
  const e = (email ?? "").trim();
  return e === "" ? ACCOUNT_DELETE_FALLBACK_PHRASE : e;
}

/** 대소문자·앞뒤 공백은 무시하고 비교한다 (이메일은 대소문자 구분이 없다) */
export function confirmMatches(expected: string, typed: FormDataEntryValue | string | null | undefined): boolean {
  const t = typeof typed === "string" ? typed.trim().toLowerCase() : "";
  return t !== "" && t === expected.trim().toLowerCase();
}
