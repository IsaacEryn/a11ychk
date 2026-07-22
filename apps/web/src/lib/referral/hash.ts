import "server-only";
import crypto from "node:crypto";

/**
 * 초대 성립 유일성 판정용 이메일 정규화·해시.
 * 원문 이메일은 저장하지 않는다 — sha256(salt + 정규화 이메일)만 referrals에 보관해
 * 탈퇴 후 재가입·plus-addressing으로 같은 사람이 반복 성립하는 것을 막는다.
 */

/**
 * 이메일 정규화 — 같은 사람의 변형 주소를 하나로 접는다.
 * - 전체: trim + 소문자
 * - 로컬파트의 plus-addressing(+ 이후) 제거 — 대부분의 메일 서비스에서 동일 수신함
 * - 점(.) 제거는 gmail 계열만 — 타 도메인은 점이 유의미하므로 오병합 방지
 */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;
  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.replaceAll(".", "");
  return `${local}@${domain}`;
}

function salt(): string {
  const s = process.env.REFERRAL_HASH_SECRET ?? process.env.INTERNAL_API_SECRET;
  if (!s || s === "change-me") throw new Error("REFERRAL_HASH_SECRET(또는 INTERNAL_API_SECRET)이 설정되지 않았습니다.");
  return s;
}

/** 정규화 이메일의 일방향 해시 (hex) — referrals.invitee_email_hash */
export function hashEmail(email: string): string {
  return crypto.createHash("sha256").update(`${salt()}:${normalizeEmail(email)}`).digest("hex");
}
