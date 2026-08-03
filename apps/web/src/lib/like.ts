/**
 * LIKE/ILIKE 패턴용 이스케이프 — 사용자 입력을 검색어로 쓸 때 필수.
 * 백슬래시를 먼저 처리해야 %/_ 이스케이프가 깨지지 않는다.
 */
export function escapeLike(raw: string): string {
  return raw.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
