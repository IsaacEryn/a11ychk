/**
 * 정기결제 주기 계산(순수 함수). 날짜는 KST 기준이다 — 앵커일(가입한 날의 KST 일자)을 지키되
 * 짧은 달은 말일로 당긴다(1/31 → 2/28 → 3/31). 시분초는 원래 시각을 유지한다.
 */
const KST_MS = 9 * 3600_000;
const DAY_MS = 86400_000;

/** 결제 예정 시각보다 이만큼 먼저 갱신 결제를 시도한다(하루 1회 크론의 지연을 흡수) */
export const CHARGE_LEAD_MS = DAY_MS;
export const GRACE_DAYS = 7;
/** 첫 실패 뒤 재시도 시점(결제 예정 시각 기준 +N일) */
const RETRY_OFFSET_DAYS = [1, 3, 5] as const;

export function kstDayOfMonth(t: number): number {
  return new Date(t + KST_MS).getUTCDate();
}

export function addInterval(fromIso: string, interval: "month" | "year", anchorDay: number): string {
  const k = new Date(Date.parse(fromIso) + KST_MS);
  const months = interval === "month" ? 1 : 12;
  const total = k.getUTCMonth() + months;
  const year = k.getUTCFullYear() + Math.floor(total / 12);
  const month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const target = Date.UTC(
    year,
    month,
    Math.min(anchorDay, lastDay),
    k.getUTCHours(),
    k.getUTCMinutes(),
    k.getUTCSeconds(),
    k.getUTCMilliseconds(),
  );
  return new Date(target - KST_MS).toISOString();
}

export function graceUntil(dueIso: string): string {
  return new Date(Date.parse(dueIso) + GRACE_DAYS * DAY_MS).toISOString();
}

/** failures = 지금까지 실패한 횟수(첫 실패 뒤 1). 남은 재시도가 없으면 null */
export function nextRetryAt(dueIso: string, failures: number): string | null {
  const offset = RETRY_OFFSET_DAYS[failures - 1];
  return offset === undefined ? null : new Date(Date.parse(dueIso) + offset * DAY_MS).toISOString();
}

export function reminderLeadMs(interval: "month" | "year"): number {
  return (interval === "year" ? 30 : 7) * DAY_MS;
}
