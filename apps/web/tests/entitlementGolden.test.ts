import { describe, expect, it } from "vitest";
import {
  getEarnedPlan,
  getExtDailyLimit,
  getSampleSize,
  getVerifiedDomainLimit,
  presetLimit,
  resolveLimits,
} from "../src/lib/quota";

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
];

/** 관리자 배정 행 — after는 Task 2 이후 기대값, immediate는 지금도 즉시 적용되던 필드 */
const ASSIGNED: { name: string; profile: ProfileFields; after: Limits }[] = [
  { name: "관리자 pro", profile: { scan_limit_override: { plan: "pro" } }, after: L(5, 10, 30, 10, 20, 3, 20, 20) },
  { name: "관리자 enterprise + plus1", profile: { scan_limit_override: { plan: "enterprise" }, earned_plan: "plus1" }, after: L(20, 30, 100, 20, 30, 10, 30, 20) },
  { name: "관리자 plus + plus2", profile: { scan_limit_override: { plan: "plus" }, earned_plan: "plus2" }, after: L(5, 8, 20, 8, 10, 2, 15, 20) },
  { name: "관리자 unlimited", profile: { scan_limit_override: { plan: "unlimited" } }, after: L(1000, 5000, 20000, 30, 30, 100, 1000, 20) },
  { name: "관리자 pro + pages 4", profile: { scan_limit_override: { plan: "pro", pages: 4 } }, after: L(5, 10, 30, 4, 8, 3, 20, 20) },
];

/** 지금(plans.active=false) 코드가 내는 실효 한도 */
function current(p: ProfileFields): Limits {
  const earned = getEarnedPlan(p.earned_plan);
  const bonus = typeof p.referral_daily_bonus === "number" ? p.referral_daily_bonus : 0;
  const o = p.scan_limit_override;
  const w = resolveLimits(o, false, earned, bonus);
  return {
    ...w,
    sampleUnverified: getSampleSize({ override: o, verified: false, plansActive: false, earned }),
    sampleVerified: getSampleSize({ override: o, verified: true, plansActive: false, earned }),
    verifiedDomains: getVerifiedDomainLimit(o, earned),
    extDaily: getExtDailyLimit(o, earned),
    presets: presetLimit(o, earned),
  };
}

describe("실효 한도 특성화 — 관리자 배정 없음", () => {
  it.each(GOLDEN)("$name", ({ profile, expected }) => {
    expect(current(profile)).toEqual(expected);
  });
});

describe("실효 한도 특성화 — 관리자 배정 중 이미 즉시 적용되던 필드", () => {
  it.each(ASSIGNED)("$name", ({ profile, after }) => {
    const c = current(profile);
    expect({ verifiedDomains: c.verifiedDomains, extDaily: c.extDaily, presets: c.presets }).toEqual({
      verifiedDomains: after.verifiedDomains,
      extDaily: after.extDaily,
      presets: after.presets,
    });
  });
});
