/**
 * 정기 검사 주기 → 실행 간격(시간). 하루 1회 크론이 이 간격 이상 지난 도메인만 검사한다.
 * 주기보다 살짝 짧게 잡아 드리프트로 하루씩 밀리는 것을 방지(예: weekly는 6.5일 후 검사).
 * 미지정·알 수 없는 값은 daily로 폴백. (순수 함수 — 테스트 대상)
 */
export const FREQUENCY_HOURS: Record<string, number> = {
  daily: 20,
  weekly: 6.5 * 24,
  monthly: 27 * 24,
};

export function dueIntervalHours(freq: unknown): number {
  return FREQUENCY_HOURS[typeof freq === "string" ? freq : "daily"] ?? FREQUENCY_HOURS.daily;
}

/**
 * 일시적 이유(사용자가 마침 수동 검사를 돌리는 중·생성 실패)로 이번 크론에서 정기 검사를 못 만들었을 때
 * 기록할 last_auto_scan_at — 다음 날 크론이 다시 대상으로 잡도록 "주기 간격 − 최소 간격(20h)" 전으로 둔다.
 * daily면 지금, weekly면 136시간 전. 다음 날의 기한 초과 시간은 약 4시간이라 오래 밀린 도메인을
 * 앞지르지 않는다(기한 초과 시간 순 정렬).
 */
export function retryNextDayAt(freq: unknown, now: number): string {
  return new Date(now - (dueIntervalHours(freq) - FREQUENCY_HOURS.daily) * 3600_000).toISOString();
}

export interface ScheduleCandidate {
  id: string;
  user_id: string;
  last_auto_scan_at: string | null;
  scan_frequency?: unknown;
}

/**
 * 이번 크론에서 정기 검사를 만들 도메인 고르기(순수 함수). 0038의 scheduled_scan_candidates와 같은 규칙.
 *
 * - 기한이 된 것만, **기한을 넘긴 시간(now − (last + 주기 간격))이 긴 순**으로. 한 번도 안 돈 도메인이 맨 앞.
 *   오래된 시각 순이면 주간·월간 도메인이 매일 도메인보다 늘 앞서고, 경과÷간격 비율 순이면 반대로
 *   매일 도메인(간격 20h)이 비율에서 앞서 같은 계정의 주간·월간 도메인이 한참 밀렸다.
 * - **계정당 1개** — 사용자당 활성 검사는 1건뿐이라(scans_one_active_per_user) 같은 계정의 둘째 도메인은
 *   어차피 동시 실행 가드에 걸린다. 예전에는 그걸 시도하다 실행 시각만 당겨져 둘째 daily 도메인이
 *   영영 돌지 않았다. 고르지 않은 형제는 시각을 건드리지 않으므로 다음 날 더 밀린 쪽이 된다.
 * 반환: 이번에 만들 도메인, 그리고 기한이 됐지만 이번에 못 고른 수(계정 중복·배치 초과 — 운영 지표).
 */
export function pickScheduledDomains<T extends ScheduleCandidate>(
  candidates: T[],
  now: number,
  batch: number,
): { picked: T[]; deferred: number } {
  const overdueMs = (d: T) => {
    if (!d.last_auto_scan_at) return Number.POSITIVE_INFINITY;
    return now - new Date(d.last_auto_scan_at).getTime() - dueIntervalHours(d.scan_frequency) * 3600_000;
  };
  const due = candidates
    .map((d) => ({ d, o: overdueMs(d) }))
    .filter((x) => x.o >= 0)
    .sort((a, b) => b.o - a.o);
  const seen = new Set<string>();
  const picked: T[] = [];
  for (const { d } of due) {
    if (seen.has(d.user_id) || picked.length >= batch) continue;
    seen.add(d.user_id);
    picked.push(d);
  }
  return { picked, deferred: due.length - picked.length };
}
