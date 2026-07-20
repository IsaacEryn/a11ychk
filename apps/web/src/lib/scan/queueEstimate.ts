/**
 * 대기열 예상 대기 시간(분) — 순수 함수(서버·테스트 공용).
 *
 * 앞선 대기 검사(ahead)들이 전역 동시 상한(max) 슬롯씩 소진되며 시작되므로,
 * 이 검사는 대략 ceil((ahead + 1) / max) 웨이브 뒤에 시작된다. 각 웨이브를
 * 평균 검사 소요(avgMin)로 환산해 정직한 상한 추정치를 만든다.
 *
 * @param ahead 이 검사보다 먼저 등록된 queued 수 (0 이상)
 * @param max   전역 동시 실행 상한 (1 이상)
 * @param avgMin 평균 검사 소요(분)
 */
export function estimateWaitMinutes(ahead: number, max: number, avgMin: number): number {
  const safeAhead = Math.max(0, Math.floor(ahead));
  const safeMax = Math.max(1, Math.floor(max));
  const waves = Math.ceil((safeAhead + 1) / safeMax);
  return waves * avgMin;
}
