/**
 * axe-core 실행기 (서버/Playwright 전용).
 * 브라우저 실행(launch)은 환경마다 다르므로 이 모듈은 Playwright Page를 받아
 * axe를 주입·실행하고, 정규화는 공유 모듈(normalize)에 위임한다.
 */
import { createRequire } from "node:module";
import type { Frame, Page } from "playwright-core";
import axe from "axe-core";
import type { PageScanResult } from "../types";
import {
  AXE_RUN_TAGS,
  THIRD_PARTY_AD_EXCLUDE,
  THIRD_PARTY_FRAME_SKIP,
  normalizeAxeResults,
  type AxeRunResults,
} from "./normalize";
import { runCustomChecks } from "./customChecks";
import { checkHtmlValidity } from "./htmlValidity";
import { settleAnimations } from "./settleAnimations";

export {
  AXE_RUN_TAGS,
  THIRD_PARTY_AD_EXCLUDE,
  THIRD_PARTY_FRAME_SKIP,
  THIRD_PARTY_WIDGET_FRAMES,
  normalizeAxeResults,
} from "./normalize";
export type { AxeRunResults } from "./normalize";

const AXE_OPTIONS = JSON.stringify({
  runOnly: { type: "tag", values: AXE_RUN_TAGS },
  resultTypes: ["violations", "passes", "incomplete"],
});

// axe 실행 컨텍스트 — 제3자 광고 요소를 제외하고 문서 전체를 검사한다.
// (exclude 항목은 선택자 배열 형태 — axe 프레임/셀렉터 규격)
const AXE_CONTEXT = JSON.stringify({ exclude: THIRD_PARTY_AD_EXCLUDE.map((s) => [s]) });

// 2-패스 안정성 필터: JS 구동 페이드인 등 렌더링 과도 상태를 axe가 측정하면
// 실행마다 결과가 달라지는 비결정적 오탐이 생긴다. 렌더링 조건(reducedMotion 등)을
// 바꾸는 대신 반복 측정으로 거른다. 1차에서 위반이 나오면 잠시 안정화를 기다린 뒤 해당
// 규칙만 재실행해, 두 번 모두 검출된 노드만 위반으로 확정한다.
const STABILITY_SETTLE_MS = 500;

// axe 공식 한국어 로케일 — failureSummary·진단 메시지를 한국어로 저장한다.
// 서비스가 한국어 우선이므로 서버 스캔은 ko 고정 (JSON은 런타임 require —
// serverExternalPackages(axe-core) 환경에서 번들 JSON import보다 안전).
const requireModule = createRequire(import.meta.url);
const AXE_KO_LOCALE = JSON.stringify(requireModule("axe-core/locales/ko.json"));

/** 한 프레임에 axe를 주입·실행. 주입·실행에 실패하거나 실행 중 detach된 프레임은 null 반환 */
async function runAxeInFrame(frame: Frame): Promise<AxeRunResults | null> {
  try {
    // 빈/about:blank 프레임(광고 슬롯 placeholder 등)은 유령 위반만 만드므로 건너뛴다.
    // 광고 iframe이 src로 식별되면 부모 프레임의 exclude로 걸러지지만, src 없는
    // same-origin about:blank 슬롯은 프레임별 검사로 들어오므로 여기서 스킵한다.
    const blank = await frame
      .evaluate(() => {
        const b = document.body;
        return (
          !document.documentElement?.getAttribute("lang") &&
          document.title.trim() === "" &&
          (!b || (b.children.length === 0 && (b.textContent ?? "").trim() === ""))
        );
      })
      .catch(() => false);
    if (blank) return null;
    await frame.evaluate(axe.source);
    // 문자열 평가 — 번들러 변환에 영향받지 않음 (프로덕션 minify ReferenceError 회피)
    // 로케일 적용 실패는 무시하고 영어 원문으로 진행 (best-effort)
    await frame.evaluate(`try { window.axe.configure({ locale: ${AXE_KO_LOCALE} }) } catch (e) {}`);
    return (await frame.evaluate(`window.axe.run(${AXE_CONTEXT}, ${AXE_OPTIONS})`)) as AxeRunResults;
  } catch {
    return null; // 주입 실패 또는 실행 중 detach — 건너뜀
  }
}

/**
 * 하위 프레임을 따로 검사하지 않을지 판정(순수). 메인 프레임에는 쓰지 않는다.
 * Playwright는 다른 출처(cross-origin) 프레임 안에도 axe를 넣을 수 있어서, 부모 문서의
 * exclude(THIRD_PARTY_AD_EXCLUDE)만으로는 광고 iframe 내부 문서가 걸러지지 않는다.
 * 프레임별 검사에서는 광고에 더해 보안 챌린지 위젯(Turnstile·hCaptcha) iframe까지
 * THIRD_PARTY_FRAME_SKIP 기준으로 건너뛴다.
 * - excluded: 프레임 요소가 광고·제3자 위젯 선택자에 맞거나 그런 요소 안에 있다
 *   (광고 네트워크·위젯 제공자 책임)
 * - rendered: 프레임 요소가 화면에 그려진다(display·visibility가 보이고 크기가 0×0이 아님).
 *   그려지지 않는 프레임의 내부 문서는 사용자에게 드러나지 않는다. iframe 요소 자체의
 *   검사(frame-title 등)는 부모 문서 검사에 그대로 남는다.
 * - parentSkipped: 바깥 프레임을 건너뛰었으면 그 안의 프레임도 건너뛴다
 */
export function shouldSkipChildFrame(s: { parentSkipped: boolean; excluded: boolean; rendered: boolean }): boolean {
  return s.parentSkipped || s.excluded || !s.rendered;
}

/** 부모 문서에서 본 프레임 요소의 상태. 읽지 못하면 null(그 프레임은 기존대로 검사한다) */
async function readFrameElementState(frame: Frame): Promise<{ excluded: boolean; rendered: boolean } | null> {
  try {
    const el = await frame.frameElement();
    try {
      return await el.evaluate((node, selectors) => {
        const e = node as Element & { checkVisibility?: (o?: { visibilityProperty?: boolean }) => boolean };
        const excluded = selectors.some((sel) => {
          try {
            return e.closest(sel) !== null;
          } catch {
            return false;
          }
        });
        const visible = e.checkVisibility ? e.checkVisibility({ visibilityProperty: true }) : e.getClientRects().length > 0;
        const rect = e.getBoundingClientRect();
        return { excluded, rendered: visible && rect.width > 0 && rect.height > 0 };
      }, THIRD_PARTY_FRAME_SKIP);
    } finally {
      await el.dispose().catch(() => undefined);
    }
  } catch {
    return null;
  }
}

function mergeAxe(target: AxeRunResults, src: AxeRunResults): void {
  target.violations.push(...src.violations);
  target.passes.push(...src.passes);
  target.incomplete.push(...src.incomplete);
}

/** 확정(재실행) 패스 — 이미 주입된 axe로 지정 규칙만 다시 실행. 실패 시 null */
async function runAxeRulesInFrame(frame: Frame, ruleIds: string[]): Promise<AxeRunResults | null> {
  const options = JSON.stringify({
    runOnly: { type: "rule", values: ruleIds },
    resultTypes: ["violations"],
  });
  try {
    // 1차 패스에서 주입 실패한 프레임은 위반도 없으므로 재주입 불필요.
    // 광고 제외 컨텍스트를 1차와 동일하게 적용해 확정 결과가 어긋나지 않게 한다.
    return (await frame.evaluate(`window.axe.run(${AXE_CONTEXT}, ${options})`)) as AxeRunResults;
  } catch {
    return null;
  }
}

/**
 * 프레임 안에서 실행 — 대상 선택자마다 지금 화면에 보이는지. 크기 0, display·visibility 숨김,
 * 누적 불투명도 0, overflow 조상에 잘림, 가로로 화면 밖이면 보이지 않는 것으로 본다.
 * 요소를 찾지 못해도 보이지 않는 것으로 본다(슬라이드가 DOM에서 빠진 경우).
 */
const VISIBLE_NOW = `(targets) => targets.map((target) => {
  try {
    const t = target[target.length - 1];
    let el = null;
    if (typeof t === "string") el = document.querySelector(t);
    else if (Array.isArray(t)) {
      let root = document;
      for (const s of t) { el = root.querySelector(s); if (!el) break; root = el.shadowRoot || el; }
    }
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (r.right <= 0 || r.left >= window.innerWidth) return false;
    let opacity = 1;
    for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.display === "none" || s.visibility === "hidden") return false;
      opacity *= Number(s.opacity);
      if (a !== el && /hidden|clip/.test(s.overflowX + " " + s.overflowY)) {
        const ar = a.getBoundingClientRect();
        if (Math.min(r.right, ar.right) <= Math.max(r.left, ar.left) || Math.min(r.bottom, ar.bottom) <= Math.max(r.top, ar.top)) return false;
      }
    }
    return opacity > 0.01;
  } catch (e) {
    return true; // 확인할 수 없으면 보이는 것으로 보고 기존처럼 걸러낸다
  }
})`;

/** 프레임 안에서 axe target으로 요소를 찾는 함수(그림자 DOM 포함) — 아래 스크립트들이 공유한다 */
const RESOLVE_TARGET = `(target) => {
  const t = target[target.length - 1];
  if (typeof t === "string") return document.querySelector(t);
  if (Array.isArray(t)) {
    let root = document, el = null;
    for (const s of t) { el = root.querySelector(s); if (!el) return null; root = el.shadowRoot || el; }
    return el;
  }
  return null;
}`;

/** 1차 패스 위반 요소를 페이지 안 WeakMap에 등록한다(요소 → {노드 키, 규칙} 목록). DOM은 건드리지 않는다. */
const REGISTER_FIRST_PASS = `(entries) => {
  const resolve = ${RESOLVE_TARGET};
  const reg = (window.__a11ychkFirstPass = new WeakMap());
  for (const e of entries) {
    try {
      const el = resolve(e.target);
      if (!el) continue;
      const list = reg.get(el) || [];
      list.push({ key: e.key, ruleId: e.ruleId });
      reg.set(el, list);
    } catch (err) {}
  }
}`;

/** 확정 패스 노드가 가리키는 요소가 1차 패스에서 등록된 요소면 그 1차 노드 키를 돌려준다(같은 규칙만) */
const LOOKUP_SAME_ELEMENT = `(entries) => {
  const resolve = ${RESOLVE_TARGET};
  const reg = window.__a11ychkFirstPass;
  const out = [];
  if (!reg) return out;
  for (const e of entries) {
    try {
      const el = resolve(e.target);
      const list = el && reg.get(el);
      if (list) for (const x of list) if (x.ruleId === e.ruleId) out.push(x.key);
    } catch (err) {}
  }
  return out;
}`;

const nodeEntries = (r: AxeRunResults) => r.violations.flatMap((v) => v.nodes.map((n) => ({ key: nodeKey(v.id, n.target), ruleId: v.id, target: n.target })));

/** 1차 패스 위반 요소 등록 — 실패해도 검사는 계속한다(그때는 선택자 문자열로만 확정) */
async function registerFirstPass(frame: Frame, result: AxeRunResults): Promise<void> {
  if (result.violations.length === 0) return;
  try {
    await frame.evaluate(`(${REGISTER_FIRST_PASS})(${JSON.stringify(nodeEntries(result))})`);
  } catch {
    // 등록 실패 — 기존 동작
  }
}

/** 확정 패스 결과 중 1차와 같은 요소를 가리키는 노드의 1차 키 */
async function lookupSameElements(frame: Frame, result: AxeRunResults): Promise<string[]> {
  if (result.violations.length === 0) return [];
  try {
    return (await frame.evaluate(`(${LOOKUP_SAME_ELEMENT})(${JSON.stringify(nodeEntries(result).map(({ ruleId, target }) => ({ ruleId, target })))})`)) as string[];
  } catch {
    return [];
  }
}

/** 확정 패스에서 빠진 후보 노드 중 지금 어느 프레임에서도 보이지 않는 것의 키 집합 */
async function findHiddenAtConfirm(frames: Frame[], first: AxeRunResults, confirm: AxeRunResults): Promise<Set<string>> {
  const confirmed = new Set<string>();
  for (const v of confirm.violations) for (const n of v.nodes) confirmed.add(nodeKey(v.id, n.target));
  const candidates: { key: string; target: unknown[] }[] = [];
  const seen = new Set<string>();
  for (const v of first.violations) {
    for (const n of v.nodes) {
      const k = nodeKey(v.id, n.target);
      if (confirmed.has(k) || seen.has(k)) continue;
      seen.add(k);
      candidates.push({ key: k, target: n.target });
    }
  }
  const hidden = new Set<string>();
  if (candidates.length === 0) return hidden;
  const visibleSomewhere = new Array(candidates.length).fill(false);
  for (const frame of frames) {
    try {
      const vis = (await frame.evaluate(`(${VISIBLE_NOW})(${JSON.stringify(candidates.map((c) => c.target))})`)) as boolean[];
      vis.forEach((v, i) => (visibleSomewhere[i] ||= v));
    } catch {
      return hidden; // 확인에 실패하면 기존 동작(모두 걸러냄)
    }
  }
  candidates.forEach((c, i) => {
    if (!visibleSomewhere[i]) hidden.add(c.key);
  });
  return hidden;
}

/** 위반 노드의 동일성 키 — 규칙 + 대상 선택자 */
function nodeKey(ruleId: string, target: unknown[]): string {
  return `${ruleId} ${JSON.stringify(target)}`;
}

/**
 * 2-패스 교차 필터 (순수 함수).
 * 확정 패스에서도 검출된 노드만 위반으로 유지한다. 단, 확정 패스 때 화면에서 사라진
 * 노드는 다시 잴 수 없었던 것이므로 1차 결과를 믿고 유지한다. 확정 패스가 같은 요소를 다른
 * 선택자 문자열로 보고한 경우도 유지한다 — 동적으로 다시 그려지는 페이지에서 axe는 같은 요소의
 * 선택자를 패스마다 다르게 만들 수 있다(속성 순서, 고르는 클래스). 둘 다 keepUnconfirmed가 판정한다.
 * 페이드인 같은 과도 상태는 같은 요소가 화면에 남은 채 정상이 되어 걸러지고, 캐러셀처럼
 * 슬라이드가 바뀌어 사라진 실제 위반은 남는다(2026-10 측정 절차 평가에서 회전 콘텐츠의
 * 실제 위반을 버리던 문제). 규칙의 모든 노드가 탈락하면 위반이 아니라 "검토 필요"
 * (incomplete)로 강등한다 — 오탐일 가능성이 높지만 실제 위반을 자동으로 무죄 방면하지는
 * 않기 위해서다.
 */
export function filterStableViolations(
  first: AxeRunResults,
  confirm: AxeRunResults,
  keepUnconfirmed: (ruleId: string, target: unknown[]) => boolean = () => false,
): { violations: AxeRunResults["violations"]; demotedRuleIds: string[] } {
  const confirmed = new Set<string>();
  for (const v of confirm.violations) {
    for (const n of v.nodes) confirmed.add(nodeKey(v.id, n.target));
  }
  const violations: AxeRunResults["violations"] = [];
  const demotedRuleIds: string[] = [];
  for (const v of first.violations) {
    const stableNodes = v.nodes.filter((n) => confirmed.has(nodeKey(v.id, n.target)) || keepUnconfirmed(v.id, n.target));
    if (stableNodes.length > 0) violations.push({ ...v, nodes: stableNodes });
    else demotedRuleIds.push(v.id);
  }
  return { violations, demotedRuleIds };
}

/**
 * 빈/미로드 문서 판정(순수). lang·title이 모두 없고 body까지 비어 있으면 페이지가
 * 실제로 로드되지 않은 것으로 본다(리다이렉트 미해결·로드 실패·차단 페이지 등).
 * lang 하나만 없다면 그건 진짜 위반이므로 여기서 걸러선 안 된다 — 세 조건이 모두
 * 성립할 때만 "빈 문서"로 확정한다.
 */
export function isBlankDocumentState(s: { hasLang: boolean; hasTitle: boolean; bodyEmpty: boolean }): boolean {
  return !s.hasLang && !s.hasTitle && s.bodyEmpty;
}

/** 문서에 lang/title/본문이 있는지 브라우저 컨텍스트에서 읽어온다. 실패 시 null */
async function readDocumentState(
  page: Page,
): Promise<{ hasLang: boolean; hasTitle: boolean; bodyEmpty: boolean } | null> {
  try {
    return await page.evaluate(() => ({
      hasLang: !!document.documentElement?.getAttribute("lang"),
      hasTitle: document.title.trim().length > 0,
      bodyEmpty:
        !document.body ||
        (document.body.children.length === 0 && (document.body.textContent ?? "").trim() === ""),
    }));
  } catch {
    return null; // 평가 실패는 빈 문서로 단정하지 않음(정상 스캔 흐름 유지)
  }
}

/** 빈 문서에서 axe를 돌려 유령 위반을 만들지 않도록 던지는 에러 */
export class EmptyDocumentError extends Error {
  constructor(url: string) {
    super(`빈 문서 — 페이지가 로드되지 않았습니다(리다이렉트 미해결·로드 실패·차단 등): ${url}`);
    this.name = "EmptyDocumentError";
  }
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

export interface RunAxeOptions {
  /**
   * 렌더링 전의 원본 HTML 소스 (rawSource.getRawSource로 확보).
   * 주어지면 마크업 유효성 검사(KWCAG 8.1.1 — 열고 닫음·중첩·속성/id 중복)를
   * 함께 수행한다. axe는 파서가 복구한 DOM만 보므로 이 검사는 원본이 필요하다.
   * 원본 소스에 접근할 수 없는 호출 환경(크롬 확장)은 생략한다.
   */
  rawHtml?: string | null;
  /**
   * 연구용 옵션. 기본값이 실서비스 동작이고, 웹·Action·MCP는 넘기지 않으므로 판정이 바뀌지 않는다.
   * 측정 절차 자체를 평가하는 실험(유한 애니메이션 종료 대기·2-패스 필터를 각각 끈 비교)에서만 쓴다.
   */
  settleAnimations?: boolean;
  stabilityFilter?: boolean;
  /**
   * 연구용. 정규화(규칙당 노드 25개 상한) 전의 원 결과와 2-패스에서 빠진 노드를 넘겨받는다.
   * 반환 결과의 형식은 그대로다.
   */
  onResearchTrace?: (trace: ResearchTrace) => void;
}

type AxeViolation = AxeRunResults["violations"][number];

/** 연구용 추적 정보 — 1차 위반, 최종 위반, 2-패스에서 빠진 노드(규칙 id와 함께) */
export interface ResearchTrace {
  firstPass: AxeViolation[];
  final: AxeViolation[];
  dropped: { ruleId: string; node: AxeViolation["nodes"][number] }[];
  /** 확정 패스에서 다시 검출되지 않았지만 그때 화면에서 사라져 있어 1차 결과대로 유지한 노드 */
  keptHidden: { ruleId: string; node: AxeViolation["nodes"][number] }[];
  /** 확정 패스가 같은 요소를 다른 선택자로 보고해 유지한 노드 */
  keptSameElement: { ruleId: string; node: AxeViolation["nodes"][number] }[];
}

/**
 * 2-패스에서 빠진 노드 목록 (순수 함수). 1차 위반 노드 중 최종 결과에 없는 것.
 * 규칙째 강등된 경우의 노드도 포함한다.
 */
export function listDroppedNodes(firstPass: AxeViolation[], final: AxeViolation[]): ResearchTrace["dropped"] {
  const kept = new Set<string>();
  for (const v of final) for (const n of v.nodes) kept.add(nodeKey(v.id, n.target));
  const dropped: ResearchTrace["dropped"] = [];
  for (const v of firstPass) {
    for (const n of v.nodes) if (!kept.has(nodeKey(v.id, n.target))) dropped.push({ ruleId: v.id, node: n });
  }
  return dropped;
}

/**
 * 로드된 페이지를 검사한다.
 * - 메인 프레임 + 하위 iframe에 axe를 각각 주입·실행해 결과를 병합
 *   (axe 단독으로는 iframe 내부를 검사하지 못해 사각지대가 됨). 광고·보안 챌린지 위젯
 *   iframe과 화면에 그려지지 않는 iframe의 내부 문서는 건너뛴다(shouldSkipChildFrame)
 * - 위반이 있으면 안정화 대기 후 해당 규칙만 재실행해 두 패스 모두 검출된
 *   노드만 위반으로 확정 (2-패스 안정성 필터 — 렌더링 과도 상태 오탐 억제)
 * - axe에 없는 자동화 가능 검사(리플로우·미디어 부재 등)를 자체 규칙으로 추가
 * - 원본 소스가 주어지면 마크업 유효성 검사를 추가 (options.rawHtml)
 */
export async function runAxeOnPage(page: Page, options?: RunAxeOptions): Promise<PageScanResult> {
  // 빈/미로드 문서 가드 — axe가 about:blank·리다이렉트 빈 응답에서 돌면
  // html-has-lang·document-title·page-has-heading-one·landmark-one-main 유령 위반이
  // 생긴다. 로드 실패로 확정되면 던져 상위에서 '실패' 처리(점수화 제외)하게 한다.
  const docState = await readDocumentState(page);
  if (docState && isBlankDocumentState(docState)) {
    throw new EmptyDocumentError(page.url());
  }

  // 재생 중인 유한 애니메이션(페이드인 등)이 끝난 화면을 잰다 — 상한 ANIMATION_SETTLE_CAP_MS,
  // 무한 반복은 기다리지 않고, 대기 실패는 검사를 막지 않는다
  if (options?.settleAnimations !== false) await settleAnimations(page);

  const merged: AxeRunResults = { violations: [], passes: [], incomplete: [] };

  const frames = page.frames();
  const mainFrame = page.mainFrame();
  const okFrames: Frame[] = [];
  const skipped = new Set<Frame>();
  for (const frame of frames) {
    if (frame !== mainFrame) {
      const parent = frame.parentFrame();
      const state = await readFrameElementState(frame);
      const skip = shouldSkipChildFrame({
        parentSkipped: parent !== null && skipped.has(parent),
        excluded: state?.excluded ?? false,
        rendered: state?.rendered ?? true,
      });
      if (skip) {
        skipped.add(frame);
        continue;
      }
    }
    const result = await runAxeInFrame(frame);
    if (result) {
      await registerFirstPass(frame, result);
      okFrames.push(frame);
      mergeAxe(merged, result);
    }
  }
  // 모든 프레임 접근 실패 시(예: 특수 문서) 메인 프레임 재시도가 이미 위에 포함됨
  if (okFrames.length === 0) {
    const main = await runAxeInFrame(page.mainFrame());
    if (main) {
      await registerFirstPass(page.mainFrame(), main);
      okFrames.push(page.mainFrame());
      mergeAxe(merged, main);
    }
  }

  // 2-패스 안정성 필터 — 1차에서 위반이 나온 규칙만 재실행하므로 비용이 작다
  const firstPass = merged.violations;
  let keptHidden: ResearchTrace["keptHidden"] = [];
  let keptSameElement: ResearchTrace["keptSameElement"] = [];
  if (options?.stabilityFilter !== false && merged.violations.length > 0) {
    const ruleIds = [...new Set(merged.violations.map((v) => v.id))];
    await page.waitForTimeout(STABILITY_SETTLE_MS).catch(() => undefined);
    const confirm: AxeRunResults = { violations: [], passes: [], incomplete: [] };
    let confirmOk = false;
    const sameElement = new Set<string>();
    for (const frame of okFrames) {
      const result = await runAxeRulesInFrame(frame, ruleIds);
      if (result) {
        confirmOk = true;
        mergeAxe(confirm, result);
        for (const k of await lookupSameElements(frame, result)) sameElement.add(k);
      }
    }
    // 확정 패스 자체가 실패하면(내비게이션 등) 필터 없이 1차 결과를 그대로 쓴다
    if (confirmOk) {
      const hidden = await findHiddenAtConfirm(okFrames, merged, confirm);
      // 추적에는 선택자로 확정되지 않은 노드만 남긴다(같은 선택자로 다시 잡힌 노드는 원래부터 확정)
      const bySelector = new Set(confirm.violations.flatMap((v) => v.nodes.map((n) => nodeKey(v.id, n.target))));
      const pick = (keys: Set<string>) => merged.violations.flatMap((v) => v.nodes.filter((n) => keys.has(nodeKey(v.id, n.target)) && !bySelector.has(nodeKey(v.id, n.target))).map((node) => ({ ruleId: v.id, node })));
      keptSameElement = pick(sameElement);
      keptHidden = pick(new Set([...hidden].filter((k) => !sameElement.has(k)))); // 같은 요소로 확인된 노드는 그쪽에만 센다
      const { violations, demotedRuleIds } = filterStableViolations(merged, confirm, (ruleId, target) => {
        const k = nodeKey(ruleId, target);
        return sameElement.has(k) || hidden.has(k);
      });
      merged.violations = violations;
      merged.incomplete.push(...demotedRuleIds.map((id) => ({ id })));
    }
  }

  if (options?.onResearchTrace) {
    options.onResearchTrace({
      firstPass,
      final: merged.violations,
      dropped: listDroppedNodes(firstPass, merged.violations),
      keptHidden,
      keptSameElement,
    });
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

  // 마크업 유효성 검사 (원본 소스가 확보된 경우만) — 실패해도 나머지 결과 유지
  if (options?.rawHtml) {
    try {
      const validity = checkHtmlValidity(options.rawHtml);
      normalized.violations.push(...validity.violations);
      normalized.passes.push(...validity.passes);
    } catch {
      // 유효성 검사 실패는 무시
    }
  }

  return normalized;
}

export const AXE_VERSION: string = axe.version;
