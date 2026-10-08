/**
 * 렌더마다 되풀이되는 읽기 오류 기록의 간격 — 같은 메시지 키는 이 프로세스에서 1분에 한 번만 기록한다.
 * 오류가 이어지는 동안 요청마다 app_errors에 한 줄씩 쌓이지 않게 한다(서버리스 인스턴스마다 따로 센다).
 * 키에는 값·이메일을 넣지 않는다 — 기록할 메시지 자체(읽기 이름·오류 코드)를 키로 쓴다.
 */

const WINDOW_MS = 60_000;
/** 키가 쌓이기만 하지 않게 — 넘치면 비우고 다시 센다(비우면 다음 한 번은 기록된다) */
const MAX_KEYS = 200;
const lastLogged = new Map<string, number>();

/** 이번에 기록할지 — 그 키를 처음 보거나 마지막 기록에서 1분이 지났으면 true(그리고 지금을 기록 시각으로 둔다) */
export function shouldLog(key: string, now: number = Date.now()): boolean {
  const last = lastLogged.get(key);
  if (last !== undefined && now - last < WINDOW_MS) return false;
  if (lastLogged.size >= MAX_KEYS && last === undefined) lastLogged.clear();
  lastLogged.set(key, now);
  return true;
}

/** 테스트 전용 — 모듈 상태를 비운다 */
export function resetLogThrottle(): void {
  lastLogged.clear();
}
