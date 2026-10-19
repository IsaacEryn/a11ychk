/**
 * 유한 애니메이션 종료 대기 — axe 1차 실행 전에, 페이지에서 돌고 있는 유한 애니메이션
 * (페이드인·슬라이드인·트랜지션 등)이 끝날 때까지 상한 안에서 기다린다.
 * 2-패스 안정성 필터는 노드 키가 규칙+선택자라서, 1차와 확정 패스 모두에 걸칠 만큼 긴
 * 페이드인은 과도 상태 대비가 그대로 위반으로 확정될 수 있다. 측정 전에 끝 상태로 보내
 * 그 빈틈을 막는다. 반복 횟수가 무한인 애니메이션(로딩 스피너 등)은 끝나지 않으므로 기다리지
 * 않는다. 타이머로 넘기는 캐러셀은 지금 재생 중인 전환만 기다린다.
 */
import type { Frame, Page } from "playwright-core";

// 검사 시간이 늘어나는 상한 — 페이지당 최대 1.5초(+ 프레임 응답 여유). 유한 애니메이션이
// 없으면 evaluate 한 번 왕복으로 끝난다.
export const ANIMATION_SETTLE_CAP_MS = 1_500;

// 애니메이션이 끝나며 다음 애니메이션을 띄우는 연쇄(animationend → 다음 단계)를 따라가는
// 최대 횟수. 상한 시간은 라운드 전체에 걸쳐 공유한다.
const MAX_ROUNDS = 3;

// 프레임이 응답하지 않을 때 evaluate가 상한을 넘겨 붙잡지 않도록 두는 여유
const EVALUATE_GRACE_MS = 200;

/**
 * 페이지 안에서 실행되는 1회 대기 (Playwright가 함수 소스를 직렬화해 보내므로 바깥 스코프를
 * 참조하지 않는다). 지금 재생 중인 유한 애니메이션이 모두 끝나거나 timeoutMs가 지나면
 * 풀리고, 기다린 애니메이션 수를 돌려준다(0이면 기다릴 것이 없었다는 뜻).
 * - 무한 반복(iterations: Infinity)은 제외 — 기다려도 끝나지 않는다
 * - 일시정지·종료·idle 상태는 제외 — playState가 running인 것만 대상
 */
export function waitFiniteAnimationsInPage(timeoutMs: number): Promise<number> {
  const pending = document.getAnimations().filter((a) => {
    if (a.playState !== "running") return false;
    const iterations = a.effect?.getComputedTiming().iterations;
    return typeof iterations === "number" && Number.isFinite(iterations);
  });
  if (pending.length === 0) return Promise.resolve(0);
  return Promise.race([
    // 취소된 애니메이션의 finished는 reject된다 — 끝난 것으로 본다
    Promise.all(pending.map((a) => a.finished.catch(() => undefined))),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]).then(() => pending.length);
}

/** 한 프레임에서 1회 대기. 실패·detach·무응답이면 0(기다릴 것 없음)으로 본다 */
async function settleFrameOnce(frame: Frame, timeoutMs: number): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      frame.evaluate(waitFiniteAnimationsInPage, timeoutMs).catch(() => 0),
      new Promise<number>((resolve) => {
        timer = setTimeout(() => resolve(0), timeoutMs + EVALUATE_GRACE_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 모든 프레임의 유한 애니메이션이 끝날 때까지 capMs 안에서 기다린다.
 * 대기는 측정 품질을 높이는 보조 단계라 실패해도 검사를 막지 않는다(예외를 던지지 않음).
 */
export async function settleAnimations(page: Page, capMs: number = ANIMATION_SETTLE_CAP_MS): Promise<void> {
  try {
    const deadline = Date.now() + capMs;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      const counts = await Promise.all(page.frames().map((frame) => settleFrameOnce(frame, remaining)));
      if (counts.every((c) => c === 0)) return;
    }
  } catch {
    // 대기 실패는 무시하고 바로 측정한다
  }
}
