/**
 * 페이지 주입 함수 모음 — 모두 자기 완결(self-contained)이어야 한다.
 * chrome.scripting.executeScript가 함수 소스를 직렬화해 페이지 컨텍스트에서
 * 실행하므로, 이 파일의 함수는 외부 모듈·클로저 변수를 참조할 수 없다.
 * 필요한 값은 전부 args로 전달할 것.
 */
import type { AxeRunResults } from "@a11ychk/core/catalog";

/** axe 로케일 설정 (MAIN world) — 실패해도 검사는 영어로 진행 */
export function configureAxeLocaleInPage(locale: unknown): void {
  try {
    // @ts-expect-error axe는 vendor 스크립트로 주입됨
    window.axe.configure({ locale });
  } catch {
    /* 로케일 불일치 등 — 무시 */
  }
}

export function runAxeInPage(tags: string[]): Promise<AxeRunResults> {
  // @ts-expect-error axe는 vendor 스크립트로 주입됨
  return window.axe.run(document, {
    runOnly: { type: "tag", values: tags },
    resultTypes: ["violations", "passes", "incomplete"],
  });
}

/**
 * 자체 커스텀 검사 신호 수집 — 정본은 core(scanner/collectSignals.ts)로 이관.
 * 여기서 재-export해 기존 import 경로("./injected")를 유지한다.
 * executeScript는 실제 함수 객체의 소스를 직렬화하므로 재-export여도 동작 동일.
 */
export { collectPageSignals } from "@a11ychk/core/catalog";


/** 페이지에서 해당 요소를 강조 표시 (스크롤 + 3초 outline) */
export function highlightInPage(selector: string): boolean {
  // 첫 매치만 강조하면 선택자가 여러 요소에 걸리는 페이지(중복 구조·동적 클래스)에서
  // 엉뚱한 요소가 강조된다 — 매치 전부(상한 10)를 강조하고 첫 요소로 스크롤.
  let els: HTMLElement[] = [];
  try {
    els = Array.from(document.querySelectorAll<HTMLElement>(selector)).slice(0, 10);
  } catch {
    els = [];
  }
  const first = els[0];
  if (!first) return false;
  first.scrollIntoView({ behavior: "smooth", block: "center" });
  for (const el of els) {
    const prevOutline = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = "3px solid #e0533d";
    el.style.outlineOffset = "2px";
    setTimeout(() => {
      el.style.outline = prevOutline;
      el.style.outlineOffset = prevOffset;
    }, 3000);
  }
  return true;
}

// ─── 페이지 주입 시각 도구 (모두 자기 완결 — chrome.scripting이 소스를 직렬화) ───

/** 오버레이 컨테이너·시뮬레이션·선형화 스타일을 모두 제거 */
export function clearOverlayInPage(): void {
  document.getElementById("a11ychk-overlay")?.remove();
  document.getElementById("a11ychk-sim-style")?.remove();
  document.getElementById("a11ychk-sim-svg")?.remove();
  document.getElementById("a11ychk-linearize")?.remove();
}

/** 페이지 전역 오버레이 헬퍼 (타입은 컴파일 시 제거 — 직렬화와 무관) */
export interface OverlayHelpers {
  makeOverlay(): HTMLElement;
  trackReposition(overlay: HTMLElement, tracked: [Element, HTMLElement][]): void;
}

/**
 * 오버레이 공용 헬퍼 설치 — 컨테이너 생성·스크롤/리사이즈 추종 재배치를 window에
 * 1회 설치한다. ISOLATED world는 확장별로 공유되므로 이후 주입되는 오버레이
 * 함수들이 재사용할 수 있다 (예전에는 동일 헬퍼가 함수마다 4중 복붙돼 있었다).
 * ⚠️ 오버레이 계열 함수보다 먼저 주입할 것 — panel/tools.ts의 runOverlayInPage가 보장.
 */
export function installOverlayHelpersInPage(): void {
  const w = window as unknown as { __a11ychkHelpers?: OverlayHelpers };
  if (w.__a11ychkHelpers) return;
  w.__a11ychkHelpers = {
    makeOverlay(): HTMLElement {
      document.getElementById("a11ychk-overlay")?.remove();
      const c = document.createElement("div");
      c.id = "a11ychk-overlay";
      c.style.cssText =
        "all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483646;pointer-events:none;";
      return c;
    },
    trackReposition(overlay: HTMLElement, tracked: [Element, HTMLElement][]): void {
    let raf = 0;
    const onChange = () => {
      if (!overlay.isConnected) {
        window.removeEventListener("scroll", onChange, true);
        window.removeEventListener("resize", onChange);
        if (raf) cancelAnimationFrame(raf);
        return;
      }
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        for (const [el, box] of tracked) {
          const r = el.getBoundingClientRect();
          box.style.left = `${r.left + window.scrollX}px`;
          box.style.top = `${r.top + window.scrollY}px`;
          box.style.width = `${Math.max(r.width, 4)}px`;
          box.style.height = `${Math.max(r.height, 4)}px`;
        }
      });
    };
    window.addEventListener("scroll", onChange, { passive: true, capture: true });
    window.addEventListener("resize", onChange, { passive: true });
    },
  };
}

/** 위반/구조 마커를 그린다. 기존 오버레이는 지우고 새로 그림 */
export function overlayMarkersInPage(markers: { selector: string; color: string; label: string }[]): number {
  const H = (window as unknown as { __a11ychkHelpers?: OverlayHelpers }).__a11ychkHelpers;
  if (!H) return 0; // 헬퍼 미설치 — runOverlayInPage 경유 호출 필요
  const c = H.makeOverlay();
  const pairs: [Element, HTMLElement][] = [];
  let drawn = 0;
  // 선택자당 매치 전부에 마커를 그린다(첫 매치만 그리면 중복 선택자에서 위치가 어긋남).
  // 전체 상한은 성능 보호용 — 위반이 극단적으로 많은 페이지에서 프리즈 방지.
  const MAX_BOXES = 300;
  const resolved: { el: Element; color: string; label: string }[] = [];
  for (const m of markers) {
    let els: Element[] = [];
    try {
      els = Array.from(document.querySelectorAll(m.selector));
    } catch {
      els = [];
    }
    for (const el of els) {
      if (resolved.length >= MAX_BOXES) break;
      resolved.push({ el, color: m.color, label: m.label });
    }
  }
  for (const m of resolved) {
    const el = m.el;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) continue;
    drawn++;
    const box = document.createElement("div");
    box.style.cssText =
      "all:initial;position:absolute;box-sizing:border-box;pointer-events:none;" +
      `border:2px solid ${m.color};` +
      `left:${r.left + window.scrollX}px;top:${r.top + window.scrollY}px;` +
      `width:${Math.max(r.width, 8)}px;height:${Math.max(r.height, 8)}px;`;
    const tag = document.createElement("span");
    tag.textContent = m.label;
    tag.style.cssText =
      "all:initial;position:absolute;left:0;top:-16px;font:700 11px/16px sans-serif;" +
      `background:${m.color};color:#fff;padding:0 5px;white-space:nowrap;border-radius:2px;`;
    box.appendChild(tag);
    c.appendChild(box);
    pairs.push([el, box]);
  }
  document.body.appendChild(c);
  H.trackReposition(c, pairs);
  return drawn;
}

/** 구조 시각화 (headings/landmarks/focus)를 페이지에서 계산해 마커 배열 반환 → 그리기 */
export function overlayStructureInPage(kind: "headings" | "landmarks" | "focus", skippedLabel: string): number {
  const H = (window as unknown as { __a11ychkHelpers?: OverlayHelpers }).__a11ychkHelpers;
  if (!H) return 0; // 헬퍼 미설치 — runOverlayInPage 경유 호출 필요
  const markers: { el: Element; color: string; label: string }[] = [];
  if (kind === "headings") {
    const hs = document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]");
    let prev = 0;
    hs.forEach((h) => {
      const lvl = h.getAttribute("aria-level") || (/H([1-6])/.exec(h.tagName)?.[1] ?? "?");
      const n = Number(lvl);
      const skip = prev > 0 && n > prev + 1;
      markers.push({
        el: h,
        color: skip ? "#e0533d" : "#0b6b5e",
        label: `H${lvl}${skip ? skippedLabel : ""}`,
      });
      if (!Number.isNaN(n)) prev = n;
    });
  } else if (kind === "landmarks") {
    const sel = "header,nav,main,aside,footer,form,[role=banner],[role=navigation],[role=main],[role=complementary],[role=contentinfo],[role=search],[role=region]";
    document.querySelectorAll(sel).forEach((el) => {
      const role = el.getAttribute("role") || el.tagName.toLowerCase();
      const name = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || "";
      markers.push({ el, color: "#7a5cff", label: name ? `${role}: ${name}` : role });
    });
  } else {
    const focusables = document.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex^="-"])',
    );
    let i = 0;
    focusables.forEach((f) => {
      const r = f.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) return;
      i++;
      markers.push({ el: f, color: "#c9761b", label: String(i) });
    });
  }
  const c = H.makeOverlay();
  const pairs: [Element, HTMLElement][] = [];
  for (const m of markers) {
    const r = m.el.getBoundingClientRect();
    const box = document.createElement("div");
    box.style.cssText =
      "all:initial;position:absolute;box-sizing:border-box;pointer-events:none;" +
      `border:2px solid ${m.color};left:${r.left + window.scrollX}px;top:${r.top + window.scrollY}px;` +
      `width:${Math.max(r.width, 8)}px;height:${Math.max(r.height, 8)}px;`;
    const tag = document.createElement("span");
    tag.textContent = m.label;
    tag.style.cssText =
      "all:initial;position:absolute;left:0;top:-16px;font:700 11px/16px sans-serif;" +
      `background:${m.color};color:#fff;padding:0 5px;white-space:nowrap;border-radius:2px;`;
    box.appendChild(tag);
    c.appendChild(box);
    pairs.push([m.el, box]);
  }
  document.body.appendChild(c);
  H.trackReposition(c, pairs);
  return markers.length;
}

/** 장애 시뮬레이션 CSS 필터 적용 (none이면 해제) */
export function applySimulationInPage(mode: string): void {
  document.getElementById("a11ychk-sim-style")?.remove();
  document.getElementById("a11ychk-sim-svg")?.remove();
  if (mode === "none") return;
  const MATRIX: Record<string, string> = {
    protanopia: "0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0",
    deuteranopia: "0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0",
    tritanopia: "0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0",
  };
  let filterValue: string;
  if (mode === "blur") filterValue = "blur(2.5px)";
  else if (mode === "grayscale") filterValue = "grayscale(1)";
  else if (MATRIX[mode]) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "a11ychk-sim-svg";
    svg.setAttribute("style", "position:absolute;width:0;height:0;");
    svg.innerHTML = `<defs><filter id="a11ychk-cb"><feColorMatrix type="matrix" values="${MATRIX[mode]}"/></filter></defs>`;
    document.body.appendChild(svg);
    filterValue = "url(#a11ychk-cb)";
  } else return;
  const style = document.createElement("style");
  style.id = "a11ychk-sim-style";
  style.textContent = `html{filter:${filterValue} !important;}`;
  document.documentElement.appendChild(style);
}

/** CSS 선형화 — DOM 읽기 순서 그대로 표시 (해제 시 스타일 제거) */
export function linearizeInPage(on: boolean): void {
  document.getElementById("a11ychk-linearize")?.remove();
  if (!on) return;
  const style = document.createElement("style");
  style.id = "a11ychk-linearize";
  style.textContent =
    "*:not(html):not(head):not(script):not(style){float:none !important;position:static !important;" +
    "display:block !important;width:auto !important;max-width:100% !important;margin-left:0 !important;" +
    "margin-right:0 !important;left:auto !important;right:auto !important;transform:none !important;}";
  document.documentElement.appendChild(style);
}

/** 클릭·터치 대상 크기 오버레이 — 각 타깃에 px 크기 표시, 24×24 미만은 빨간색 (WCAG 2.5.8) */
export function overlayTargetSizeInPage(): number {
  const H = (window as unknown as { __a11ychkHelpers?: OverlayHelpers }).__a11ychkHelpers;
  if (!H) return 0; // 헬퍼 미설치 — runOverlayInPage 경유 호출 필요
  const c = H.makeOverlay();
  const targets = document.querySelectorAll<HTMLElement>(
    "a[href],button,input:not([type=hidden]),select,textarea,[role=button],[tabindex]:not([tabindex^='-'])",
  );
  const pairs: [Element, HTMLElement][] = [];
  let n = 0;
  targets.forEach((el) => {
    const st = getComputedStyle(el);
    if (st.display === "inline") return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return;
    n++;
    const small = r.width < 24 || r.height < 24;
    const color = small ? "#e0533d" : "#0b6b5e";
    const box = document.createElement("div");
    box.style.cssText =
      "all:initial;position:absolute;box-sizing:border-box;pointer-events:none;" +
      `border:2px solid ${color};left:${r.left + window.scrollX}px;top:${r.top + window.scrollY}px;` +
      `width:${Math.max(r.width, 4)}px;height:${Math.max(r.height, 4)}px;`;
    const tag = document.createElement("span");
    tag.textContent = `${Math.round(r.width)}×${Math.round(r.height)}`;
    tag.style.cssText =
      "all:initial;position:absolute;left:0;top:-15px;font:700 10px/15px sans-serif;" +
      `background:${color};color:#fff;padding:0 4px;white-space:nowrap;border-radius:2px;`;
    box.appendChild(tag);
    c.appendChild(box);
    pairs.push([el, box]);
  });
  document.body.appendChild(c);
  H.trackReposition(c, pairs);
  return n;
}

/** 선택자에 맞는 모든 요소를 강조 (수동 점검 항목별 맞춤 강조용) */
export function overlayQueryInPage(selector: string, tagSome: string, tagNone: string): number {
  const H = (window as unknown as { __a11ychkHelpers?: OverlayHelpers }).__a11ychkHelpers;
  if (!H) return 0; // 헬퍼 미설치 — runOverlayInPage 경유 호출 필요
  const c = H.makeOverlay();
  let els: Element[];
  try {
    els = Array.from(document.querySelectorAll(selector));
  } catch {
    els = [];
  }
  const pairs: [Element, HTMLElement][] = [];
  let n = 0;
  els.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return;
    n++;
    const box = document.createElement("div");
    box.style.cssText =
      "all:initial;position:absolute;box-sizing:border-box;pointer-events:none;" +
      "border:2px solid #c9761b;background:rgba(201,118,27,.12);" +
      `left:${r.left + window.scrollX}px;top:${r.top + window.scrollY}px;` +
      `width:${Math.max(r.width, 8)}px;height:${Math.max(r.height, 8)}px;`;
    c.appendChild(box);
    pairs.push([el, box]);
  });
  const tag = document.createElement("div");
  // tagSome은 "{n}" 자리에 개수를 치환하는 로컬라이즈된 템플릿 (페이지 컨텍스트라 chrome.i18n 미사용)
  tag.textContent = n > 0 ? tagSome.replace("{n}", String(n)) : tagNone;
  tag.style.cssText =
    "all:initial;position:fixed;left:8px;bottom:8px;z-index:2147483647;background:#c9761b;color:#fff;" +
    "font:700 12px sans-serif;padding:5px 11px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.25);";
  c.appendChild(tag);
  document.body.appendChild(c);
  H.trackReposition(c, pairs);
  return n;
}
