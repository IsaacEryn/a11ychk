/**
 * 닉네임 사칭 방지 — 관리자가 아닌 사용자가 운영진을 사칭할 수 있는
 * 닉네임(관리자, 운영자, admin 등)을 쓰지 못하도록 검사한다.
 * 실제 관리자(role=admin)는 이 제한에서 제외한다.
 */
const BANNED_TOKENS = [
  "관리자",
  "관리팀",
  "운영자",
  "운영팀",
  "운영진",
  "admin", // administrator, sysadmin 등도 포함
  "root",
  "superuser",
  "moderator",
  "official",
  "공식",
  "a11ychk",
  "a11ycheck",
];

/** 공백·구분기호를 제거하고 소문자화해 우회(예: "관 리 자", "a.d.m.i.n")를 차단 */
export function isImpersonatingNickname(raw: string): boolean {
  const normalized = raw.toLowerCase().replace(/[\s._\-()[\]{}*~|]/g, "");
  return BANNED_TOKENS.some((token) => normalized.includes(token));
}
