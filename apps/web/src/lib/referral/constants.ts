import "server-only";

/** 초대 코드 쿠키 — /join/[code]가 심고, auth 콜백이 소비 후 삭제 */
export const REFERRAL_COOKIE = "a11ychk_ref";
export const REFERRAL_COOKIE_MAX_AGE = 30 * 24 * 3600; // 30일 (초)

/** plus1 달성에 필요한 유효 초대 수 */
export const REFERRAL_VALID_GOAL = 5;
/** 초대자당 총 성립 상한 — 대량 어뷰즈 피해 캡 */
export const REFERRAL_VALID_CAP = 20;
/** 초대자당 하루 성립 반영 상한 — 초과분은 다음날 크론이 재처리 */
export const REFERRAL_VELOCITY_PER_DAY = 2;

/** 피초대자 가입 보너스 — 일 검사 한도 가산치 */
export const REFERRAL_INVITEE_DAILY_BONUS = 1;
