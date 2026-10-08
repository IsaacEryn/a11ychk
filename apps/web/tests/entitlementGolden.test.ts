import { describe, expect, it } from "vitest";
import { resolveEntitlement } from "../src/lib/entitlements";

/**
 * 실효 한도 특성화 표 — 2026-10 프로덕션(plans.active=false) 동작을 숫자로 고정한다.
 * 권한 계산을 갈아엎어도 관리자 배정이 없는 사용자는 한 칸도 바뀌면 안 된다.
 */
export interface Limits {
  daily: number;
  weekly: number;
  monthly: number;
  sampleUnverified: number;
  sampleVerified: number;
  verifiedDomains: number;
  extDaily: number;
  presets: number;
}

interface ProfileFields {
  scan_limit_override?: unknown;
  earned_plan?: unknown;
  referral_daily_bonus?: unknown;
}

const PAST = "2020-01-01T23:59:59+09:00";
const L = (
  daily: number, weekly: number, monthly: number,
  sampleUnverified: number, sampleVerified: number,
  verifiedDomains: number, extDaily: number, presets: number,
): Limits => ({ daily, weekly, monthly, sampleUnverified, sampleVerified, verifiedDomains, extDaily, presets });

const FREE = L(3, 5, 10, 5, 10, 1, 10, 3);

/** 관리자 배정이 없는 입력 — 리팩터 전후 완전히 같아야 한다 */
const GOLDEN: { name: string; profile: ProfileFields; expected: Limits }[] = [
  { name: "기본", profile: {}, expected: FREE },
  { name: "초대 가입 보너스", profile: { referral_daily_bonus: 1 }, expected: L(4, 5, 10, 5, 10, 1, 10, 3) },
  { name: "plus1", profile: { earned_plan: "plus1" }, expected: L(5, 6, 15, 5, 10, 1, 12, 20) },
  { name: "plus2", profile: { earned_plan: "plus2" }, expected: L(5, 8, 20, 8, 10, 2, 15, 20) },
  { name: "plus1 + 보너스", profile: { earned_plan: "plus1", referral_daily_bonus: 1 }, expected: L(6, 6, 15, 5, 10, 1, 12, 20) },
  { name: "daily 개별값은 보너스를 덮는다", profile: { scan_limit_override: { daily: 7 }, referral_daily_bonus: 1 }, expected: L(7, 5, 10, 5, 10, 1, 10, 3) },
  { name: "pages 8 — 소유 확인은 2배", profile: { scan_limit_override: { pages: 8 } }, expected: L(3, 5, 10, 8, 16, 1, 10, 3) },
  { name: "pages 20 — 소유 확인은 30 상한", profile: { scan_limit_override: { pages: 20 } }, expected: L(3, 5, 10, 20, 30, 1, 10, 3) },
  { name: "pages 개별값은 초대 등급 표본을 덮는다", profile: { scan_limit_override: { pages: 3 }, earned_plan: "plus2" }, expected: L(5, 8, 20, 3, 6, 2, 15, 20) },
  { name: "소유 확인 수·확장 개별값", profile: { scan_limit_override: { verifiedDomains: 4, extDaily: 5 } }, expected: L(3, 5, 10, 5, 10, 4, 5, 3) },
  { name: "확장 0 허용(차단)", profile: { scan_limit_override: { extDaily: 0 } }, expected: L(3, 5, 10, 5, 10, 1, 0, 3) },
  { name: "기한 지난 배정은 무시", profile: { scan_limit_override: { plan: "pro", daily: 99, pages: 20, until: PAST } }, expected: FREE },
  { name: "명시적 free 배정", profile: { scan_limit_override: { plan: "free" } }, expected: FREE },
  { name: "알 수 없는 등급", profile: { scan_limit_override: { plan: "vip" } }, expected: FREE },
  { name: "구 plus earned_plan 값은 무시", profile: { earned_plan: "plus" }, expected: FREE },
  { name: "daily 0 개별값은 초대 등급보다 우선", profile: { scan_limit_override: { daily: 0 }, earned_plan: "plus2" }, expected: L(0, 8, 20, 8, 10, 2, 15, 20) },
  { name: "음수 개별값은 무시", profile: { scan_limit_override: { daily: -1 } }, expected: FREE },
  { name: "문자열 개별값은 무시", profile: { scan_limit_override: { daily: "10" } }, expected: FREE },
  { name: "정수가 아닌 소유 확인 수는 무시", profile: { scan_limit_override: { verifiedDomains: 1.5 } }, expected: FREE },
  { name: "pages 0은 무시", profile: { scan_limit_override: { pages: 0 } }, expected: FREE },
];

/** 관리자 배정 행 — after는 관리자 배정이 즉시 모든 한도에 적용된 뒤의 기대값 */
const ASSIGNED: { name: string; profile: ProfileFields; after: Limits }[] = [
  { name: "관리자 pro", profile: { scan_limit_override: { plan: "pro" } }, after: L(5, 10, 30, 10, 20, 3, 20, 20) },
  { name: "관리자 enterprise + plus1", profile: { scan_limit_override: { plan: "enterprise" }, earned_plan: "plus1" }, after: L(20, 30, 100, 20, 30, 10, 30, 20) },
  { name: "관리자 plus + plus2", profile: { scan_limit_override: { plan: "plus" }, earned_plan: "plus2" }, after: L(5, 8, 20, 8, 10, 2, 15, 20) },
  { name: "관리자 unlimited", profile: { scan_limit_override: { plan: "unlimited" } }, after: L(1000, 5000, 20000, 30, 30, 100, 1000, 20) },
  { name: "관리자 pro + pages 4", profile: { scan_limit_override: { plan: "pro", pages: 4 } }, after: L(5, 10, 30, 4, 8, 3, 20, 20) },
];

/** 새 권한 계산이 내는 실효 한도 */
function current(p: ProfileFields): Limits {
  return { ...resolveEntitlement(p).limits };
}

describe("실효 한도 특성화 — 관리자 배정 없음", () => {
  it.each(GOLDEN)("$name", ({ profile, expected }) => {
    expect(current(profile)).toEqual(expected);
  });
});

describe("실효 한도 — 관리자 배정은 즉시 모든 한도에 적용된다", () => {
  it.each(ASSIGNED)("$name", ({ profile, after }) => {
    expect(current(profile)).toEqual(after);
  });
});
