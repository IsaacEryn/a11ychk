/** FNV-1a 32비트 해시 — 결정적 tiebreak·시드 용도의 경량 문자열 해시. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
