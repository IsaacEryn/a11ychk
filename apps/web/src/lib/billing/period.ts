/**
 * 정기결제 주기 계산(순수 함수). 날짜는 KST 기준이다 — 앵커일(가입한 날의 KST 일자)을 지키되
 * 짧은 달은 말일로 당긴다(1/31 → 2/28 → 3/31). 시분초는 원래 시각을 유지한다.
 * 결제 흐름이 함께 쓰는 시간 상수·ISO 표기 헬퍼도 여기 한 곳에 둔다.
 */
const KST_MS = 9 * 3600_000;
export const DAY_MS = 86_400_000;

/** 흐름이 저장소에 쓰는 시각 표기(Z) — 비교는 늘 Date.parse로 한다(DB는 +00:00으로 돌려준다) */
export const iso = (t: number) => new Date(t).toISOString();

/** 결제 예정 시각보다 이만큼 먼저 갱신 결제를 시도한다(하루 1회 크론의 지연을 흡수) */
export const CHARGE_LEAD_MS = DAY_MS;

/**
 * 기간 끝(periodEnd)에 대한 갱신 결제가 나갈 수 있는 가장 이른 시각 — 크론은 이때부터 결제한다.
 * 사용자에게 "다음 결제일"로 알리는 시각은 모두 이것이다(결제 확인 화면·동의 스냅샷·결제 예정 안내 메일·영수증).
 */
export function earliestChargeAt(periodEnd: string): string {
  return new Date(Date.parse(periodEnd) - CHARGE_LEAD_MS).toISOString();
}
/**
 * 화면에 보이는 다음 결제일 — 가장 이른 청구 시각이 이미 지났으면(기간의 마지막 날·크론 대기) 지금.
 * 지난 날짜를 "다음 결제일"로 보이지 않게 한다. now를 비우면 지금 시각(요청마다 렌더되는 화면용).
 */
export function upcomingChargeAt(periodEnd: string, now: number = Date.now()): string {
  return new Date(Math.max(now, Date.parse(earliestChargeAt(periodEnd)))).toISOString();
}
export const GRACE_DAYS = 7;
/** 첫 실패 뒤 재시도 시점(결제 예정 시각 기준 +N일) */
const RETRY_OFFSET_DAYS = [1, 3, 5] as const;

export function kstDayOfMonth(t: number): number {
  return new Date(t + KST_MS).getUTCDate();
}

/** t(UTC 밀리초)가 속한 KST 날짜의 0시 */
export function kstStartOfDay(t: number): number {
  const k = t + KST_MS;
  return k - (((k % DAY_MS) + DAY_MS) % DAY_MS) - KST_MS;
}

/**
 * 한 주기 뒤 — fromIso(이전 기간 끝, 첫 결제면 결제 시각)에서 interval만큼, 일자는 anchorDay(짧은 달은 말일).
 * 호출 규약: anchorDay는 구독의 billing_anchor_day(없으면 fromIso의 KST 일자)를 넘긴다. 앞 기간 끝의 일자를 넘기면
 * 2월을 지난 31일 구독이 28일로 굳는다. 잘못된 입력(파싱할 수 없는 시각, 1~31 밖이거나 정수가 아닌 앵커일)은 던진다 —
 * 잘못 계산한 기간으로 결제 행을 만드는 것보다 그 행만 오류로 남기는 편이 낫다(크론은 행 단위로 잡아 기록한다).
 */
export function addInterval(fromIso: string, interval: "month" | "year", anchorDay: number): string {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) throw new Error("addInterval: invalid start time");
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) throw new Error("addInterval: anchor day must be 1-31");
  const k = new Date(from + KST_MS);
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

/**
 * 미납 구독의 유예가 끝났는지 — 저장된 유예 기한, 없으면 기간 끝 + 7일. 크론의 미납 종료(end_unpaid)와 같은 기준이라
 * 이 시각부터는 재시도·카드 변경 재결제를 하지 않는다(종료와 재결제가 시각으로 서로 배타가 된다).
 */
export function graceOver(sub: { grace_until: string | null; current_period_end: string }, now: number): boolean {
  return now >= Date.parse(sub.grace_until ?? graceUntil(sub.current_period_end));
}

/** failures = 지금까지 실패한 횟수(첫 실패 뒤 1). 남은 재시도가 없으면 null */
export function nextRetryAt(dueIso: string, failures: number): string | null {
  const offset = RETRY_OFFSET_DAYS[failures - 1];
  return offset === undefined ? null : new Date(Date.parse(dueIso) + offset * DAY_MS).toISOString();
}

export function reminderLeadMs(interval: "month" | "year"): number {
  return (interval === "year" ? 30 : 7) * DAY_MS;
}

/**
 * 결제 예정 안내를 보내기 시작하는 시각 — 안내 메일이 알리는 결제일(earliestChargeAt)의 KST 0시에서 월간 7일·연간 30일 전.
 * 하루 한 번(10:00 KST) 도는 크론이 그날 보내므로 알린 결제일까지 정확히 7일(30일)이 남는다. 실제 청구는 그 결제일이거나
 * (결제 시각이 크론 시각보다 늦으면) 다음 날이라, 알린 날보다 먼저 청구되지 않는다.
 */
export function reminderFrom(periodEnd: string, interval: "month" | "year"): number {
  return kstStartOfDay(Date.parse(earliestChargeAt(periodEnd))) - reminderLeadMs(interval);
}
