import type { CardSummary } from "./toss";

/**
 * 카드 표기(순수 함수) — 결제 관리 화면과 결제 메일이 같은 함수를 쓴다(화면·메일의 카드 줄이 어긋나지 않게).
 * 문구는 메일 관례대로 코드에 둔다(메일은 서버가 locale을 정해 보낸다 — messages JSON을 쓰지 않는다).
 */

/** 토스가 주는 카드 종류(한국어 원값) → 표시 이름 */
const CARD_TYPES: Record<string, { ko: string; en: string }> = {
  신용: { ko: "신용카드", en: "Credit card" },
  체크: { ko: "체크카드", en: "Debit card" },
  기프트: { ko: "기프트카드", en: "Gift card" },
};

/**
 * "종류 + 토스가 준 마스킹 번호"(예: 신용카드 1234****, Credit card 1234****). 번호가 없으면 null.
 * 모르는 카드 종류는 한국어에서만 원값 그대로 쓰고, 영어에서는 빼고 번호만 보인다 — 한국어 원값이 영문에 섞이지 않게.
 */
export function cardLabel(card: Pick<CardSummary, "cardType" | "number"> | null | undefined, locale: "ko" | "en"): string | null {
  if (!card?.number) return null;
  const known = card.cardType ? CARD_TYPES[card.cardType] : undefined;
  const type = known ? known[locale] : locale === "ko" ? card.cardType : null;
  return [type, card.number].filter(Boolean).join(" ");
}
