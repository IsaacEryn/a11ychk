// ─── 명도대비 스포이드 (배경색/글자색 각각 선택 + AA/AAA 판정 + 개선 색 제안) ───
import { $ } from "./state";
import { msg } from "../i18n";

/** 선택된 두 색 — 공유 가변 상태는 객체 필드로 (탭 전환 시 초기화와 참조 공유) */
const cc = { bg: null as string | null, fg: null as string | null };

const HEX6 = /^#?([0-9a-f]{6})$/i;

/** 상대 휘도 (WCAG 정의). hex가 #rrggbb가 아니면 0 */
function relLum(hex: string): number {
  const m = HEX6.exec(hex.trim());
  if (!m || !m[1]) return 0;
  const v = parseInt(m[1], 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}

function ratioOf(a: string, b: string): number {
  const l1 = relLum(a);
  const l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** bg에 대해 AA(4.5:1)를 통과하는, fg에 가장 가까운 색 제안 (검정/흰색 방향 혼합) */
function suggestColor(bg: string, fg: string): string | null {
  const mix = (hex: string, tgt: number, t: number): string => {
    const m = HEX6.exec(hex);
    if (!m || !m[1]) return hex; // 잘못된 hex면 원본 그대로
    const v = parseInt(m[1], 16);
    const parts = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => Math.round(c + (tgt - c) * t));
    return "#" + parts.map((c) => c.toString(16).padStart(2, "0")).join("");
  };
  for (let t = 0.05; t <= 1; t += 0.05) {
    for (const tgt of [0, 255]) {
      const cand = mix(fg, tgt, t);
      if (ratioOf(bg, cand) >= 4.5) return cand;
    }
  }
  return null;
}

async function pickScreenColor(): Promise<string | null> {
  const w = window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } };
  if (!w.EyeDropper) return "unsupported";
  try {
    const r = await new w.EyeDropper().open();
    return r.sRGBHex;
  } catch {
    return null; // 사용자 취소 등
  }
}

function renderContrast() {
  const out = $("ccResult");
  ($("bgSwatch") as HTMLElement).style.background = cc.bg ?? "";
  ($("fgSwatch") as HTMLElement).style.background = cc.fg ?? "";
  if (!cc.bg || !cc.fg) {
    out.textContent = cc.bg || cc.fg ? msg("ccPickOther") : "";
    return;
  }
  const ratio = Math.round(ratioOf(cc.bg, cc.fg) * 100) / 100;
  const aa = ratio >= 4.5;
  const aaLarge = ratio >= 3;
  const aaa = ratio >= 7;
  out.innerHTML = "";

  const preview = document.createElement("div");
  preview.className = "cc-preview";
  preview.style.background = cc.bg;
  preview.style.color = cc.fg;
  preview.textContent = msg("ccSample");
  out.appendChild(preview);

  const ratioEl = document.createElement("div");
  ratioEl.append(`${msg("ccRatioLabel")} `);
  const ratioVal = document.createElement("span");
  ratioVal.className = "cc-ratio";
  ratioVal.textContent = String(ratio);
  ratioEl.append(ratioVal, " : 1 ");
  const pair = document.createElement("span");
  pair.style.color = "var(--ink-faint)";
  pair.textContent = `(${cc.bg} / ${cc.fg})`;
  ratioEl.appendChild(pair);
  out.appendChild(ratioEl);

  const badges = document.createElement("div");
  badges.className = "cc-badges";
  const mk = (label: string, ok: boolean) => {
    const s = document.createElement("span");
    s.className = `cc-badge ${ok ? "pass" : "fail"}`;
    s.textContent = `${label} ${ok ? "✓" : "✗"}`;
    return s;
  };
  badges.append(mk(msg("ccAaNormal"), aa), mk(msg("ccAaLarge"), aaLarge), mk("AAA", aaa));
  out.appendChild(badges);

  if (!aa) {
    const guide = document.createElement("div");
    guide.className = "cc-guide";
    guide.append(msg("ccGuideFail"));
    const suggestion = suggestColor(cc.bg, cc.fg);
    if (suggestion) {
      guide.appendChild(document.createElement("br"));
      guide.append(`${msg("ccSuggestion")} `);
      const b = document.createElement("b");
      b.style.color = suggestion;
      b.textContent = suggestion;
      guide.append(b, " ");
      const swatch = document.createElement("span");
      swatch.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:3px;background:${suggestion};border:1px solid var(--line);vertical-align:middle`;
      guide.appendChild(swatch);
      guide.append(msg("ccRatioSuffix", [Math.round(ratioOf(cc.bg, suggestion) * 100) / 100]));
    }
    out.appendChild(guide);
  }
}

/** 배경/글자 스포이드 버튼 배선 (도구 초기화 시 1회) */
export function wireContrastPicker() {
  const bgBtn = $<HTMLButtonElement>("pickBg");
  const fgBtn = $<HTMLButtonElement>("pickFg");
  const pick = async (which: "bg" | "fg", btn: HTMLButtonElement) => {
    const label = btn.childNodes[0];
    const prev = label?.textContent ?? "";
    if (label) label.textContent = which === "bg" ? msg("ccPickingBg") : msg("ccPickingFg");
    const c = await pickScreenColor();
    if (label) label.textContent = prev;
    if (c === "unsupported") {
      $("ccResult").textContent = msg("ccNoEyedropper");
      return;
    }
    if (!c) return;
    if (which === "bg") cc.bg = c;
    else cc.fg = c;
    renderContrast();
  };
  bgBtn.addEventListener("click", () => pick("bg", bgBtn));
  fgBtn.addEventListener("click", () => pick("fg", fgBtn));
}
