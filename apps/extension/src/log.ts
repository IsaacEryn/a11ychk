/**
 * 확장 경량 로거. 조용히 삼키던 실패(주입·저장·캐시)에 최소한의 흔적을 남긴다.
 * 서버가 없는 클라이언트라 console에 남기되, 필드에서 개발자도구로 원인을 좇을 수 있게
 * 일관된 접두사를 붙인다. 사용자 화면에는 영향을 주지 않는다(진단 전용).
 */
const PREFIX = "[a11ychk]";

export function warn(message: string, err?: unknown): void {
  if (err !== undefined) console.warn(PREFIX, message, err);
  else console.warn(PREFIX, message);
}

export function error(message: string, err?: unknown): void {
  if (err !== undefined) console.error(PREFIX, message, err);
  else console.error(PREFIX, message);
}
