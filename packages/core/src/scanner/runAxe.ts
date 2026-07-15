/**
 * axe-core 실행기 (서버/Playwright 전용).
 * 브라우저 실행(launch)은 환경마다 다르므로 이 모듈은 Playwright Page를 받아
 * axe를 주입·실행하고, 정규화는 공유 모듈(normalize)에 위임한다.
 */
import type { Frame, Page } from "playwright-core";
import axe from "axe-core";
import type { PageScanResult } from "../types";
import { AXE_RUN_TAGS, normalizeAxeResults, type AxeRunResults } from "./normalize";
import { runCustomChecks } from "./customChecks";

export { AXE_RUN_TAGS, normalizeAxeResults } from "./normalize";
export type { AxeRunResults } from "./normalize";

const AXE_OPTIONS = JSON.stringify({
  runOnly: { type: "tag", values: AXE_RUN_TAGS },
  resultTypes: ["violations", "passes", "incomplete"],
});

/** 한 프레임에 axe를 주입·실행. cross-origin·detached 프레임은 null 반환 */
async function runAxeInFrame(frame: Frame): Promise<AxeRunResults | null> {
  try {
    await frame.evaluate(axe.source);
    // 문자열 평가 — 번들러 변환에 영향받지 않음 (프로덕션 minify ReferenceError 회피)
    return (await frame.evaluate(`window.axe.run(document, ${AXE_OPTIONS})`)) as AxeRunResults;
  } catch {
    return null; // cross-origin frame(접근 불가) 또는 실행 중 detach — 건너뜀
  }
}

function mergeAxe(target: AxeRunResults, src: AxeRunResults): void {
  target.violations.push(...src.violations);
  target.passes.push(...src.passes);
  target.incomplete.push(...src.incomplete);
}

/** passes/incomplete는 규칙 id 기준 중복 제거 */
function dedupeById(list: { id: string }[]): { id: string }[] {
  const seen = new Set<string>();
  const out: { id: string }[] = [];
  for (const item of list) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/**
 * 로드된 페이지를 검사한다.
 * - 메인 프레임 + 모든 same-origin iframe에 axe를 각각 주입·실행해 결과를 병합
 *   (axe 단독으로는 iframe 내부를 검사하지 못해 사각지대가 됨)
 * - axe에 없는 자동화 가능 검사(리플로우·미디어 부재 등)를 자체 규칙으로 추가
 */
export async function runAxeOnPage(page: Page): Promise<PageScanResult> {
  const merged: AxeRunResults = { violations: [], passes: [], incomplete: [] };

  const frames = page.frames();
  let anyFrameOk = false;
  for (const frame of frames) {
    const result = await runAxeInFrame(frame);
    if (result) {
      anyFrameOk = true;
      mergeAxe(merged, result);
    }
  }
  // 모든 프레임 접근 실패 시(예: 특수 문서) 메인 프레임 재시도가 이미 위에 포함됨
  if (!anyFrameOk) {
    const main = await runAxeInFrame(page.mainFrame());
    if (main) mergeAxe(merged, main);
  }

  merged.passes = dedupeById(merged.passes) as { id: string }[];
  merged.incomplete = dedupeById(merged.incomplete) as { id: string }[];

  const normalized = normalizeAxeResults(page.url(), merged);

  // 자체 커스텀 검사 (axe 미커버 SC) — 실패해도 axe 결과는 유지
  try {
    const custom = await runCustomChecks(page);
    normalized.violations.push(...custom.violations);
    normalized.passes.push(...custom.passes);
    normalized.incomplete.push(...custom.incomplete);
  } catch {
    // 커스텀 검사 실패는 무시 (axe 결과만으로 진행)
  }

  return normalized;
}

export const AXE_VERSION: string = axe.version;
