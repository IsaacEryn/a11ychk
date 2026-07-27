/**
 * 공통 버튼 클래스. 곳곳에 흩어져 복붙되던 Tailwind 덩어리를 한 곳에 모은다.
 * 색은 globals.css 토큰(모두 AA 대비 검증됨)만 사용.
 * - BTN_OUTLINE: 보조 액션(적용·저장 등) — seal 테두리
 * - BTN_SOLID: 주요 액션(검사 시작 등) — seal 채움
 */
export const BTN_OUTLINE =
  "rounded border-[1.5px] border-[var(--color-seal)] px-3 py-1.5 text-sm font-semibold text-[var(--color-seal)] hover:bg-[var(--color-seal-tint)] disabled:opacity-60";

export const BTN_SOLID =
  "rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60";
