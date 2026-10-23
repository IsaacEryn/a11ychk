import { describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import {
  AxeRunError,
  axeErrorReason,
  isBlankDocumentState,
  runAxeOnPage,
  type AxeRunResults,
  shouldSkipChildFrame,
  THIRD_PARTY_AD_EXCLUDE,
  THIRD_PARTY_FRAME_SKIP,
  THIRD_PARTY_WIDGET_FRAMES,
} from "../src/scanner/runAxe";

describe("isBlankDocumentState — 빈/미로드 문서 가드", () => {
  it("lang·title·body가 모두 비면 빈 문서로 본다(리다이렉트 빈 응답·about:blank)", () => {
    expect(isBlankDocumentState({ hasLang: false, hasTitle: false, bodyEmpty: true })).toBe(true);
  });

  it("본문이 있으면 lang·title이 없어도 빈 문서가 아니다 — 진짜 위반이므로 검사 대상", () => {
    expect(isBlankDocumentState({ hasLang: false, hasTitle: false, bodyEmpty: false })).toBe(false);
  });

  it("lang만 없는 정상 페이지는 빈 문서가 아니다(html-has-lang 위반은 axe가 잡아야 함)", () => {
    expect(isBlankDocumentState({ hasLang: false, hasTitle: true, bodyEmpty: false })).toBe(false);
  });

  it("정상 페이지(lang·title·본문 모두 있음)는 빈 문서가 아니다", () => {
    expect(isBlankDocumentState({ hasLang: true, hasTitle: true, bodyEmpty: false })).toBe(false);
  });

  it("title은 있으나 body가 빈 경우도 빈 문서가 아니다(세 조건 모두여야 확정)", () => {
    expect(isBlankDocumentState({ hasLang: false, hasTitle: true, bodyEmpty: true })).toBe(false);
  });
});

describe("THIRD_PARTY_AD_EXCLUDE — 제3자 광고 요소 제외 선택자", () => {
  const matchesAny = (sel: string) => THIRD_PARTY_AD_EXCLUDE.some((p) => p.includes(sel));

  it("AdSense/DoubleClick/reCAPTCHA 핵심 도메인·컨테이너를 포함한다", () => {
    expect(matchesAny("googlesyndication.com")).toBe(true); // sodar 추적 이미지
    expect(matchesAny("doubleclick.net")).toBe(true); // 광고 슬롯 iframe
    expect(matchesAny("google.com/recaptcha")).toBe(true);
    expect(matchesAny("adsbygoogle")).toBe(true);
  });

  it("태그 무관 [src*=...] 선택자가 있어 img(sodar) 등 iframe 아닌 요소도 걸러진다", () => {
    expect(THIRD_PARTY_AD_EXCLUDE).toContain('[src*="googlesyndication.com"]');
  });

  it("axe exclude 컨텍스트 형태(선택자 배열의 배열)로 변환 가능하다", () => {
    const ctx = { exclude: THIRD_PARTY_AD_EXCLUDE.map((s) => [s]) };
    expect(Array.isArray(ctx.exclude)).toBe(true);
    expect(ctx.exclude.every((e) => Array.isArray(e) && typeof e[0] === "string")).toBe(true);
  });
});

describe("THIRD_PARTY_WIDGET_FRAMES — 보안 챌린지 위젯 iframe", () => {
  it("Cloudflare Turnstile·hCaptcha iframe을 가리킨다", () => {
    expect(THIRD_PARTY_WIDGET_FRAMES).toContain('iframe[src*="challenges.cloudflare.com"]');
    expect(THIRD_PARTY_WIDGET_FRAMES).toContain('iframe[src*="hcaptcha.com"]');
  });

  it("프레임 건너뛰기 선택자는 광고 제외 선택자와 위젯 iframe을 모두 담는다", () => {
    for (const sel of [...THIRD_PARTY_AD_EXCLUDE, ...THIRD_PARTY_WIDGET_FRAMES]) {
      expect(THIRD_PARTY_FRAME_SKIP).toContain(sel);
    }
  });

  it("axe exclude에는 넣지 않는다 — iframe 요소 자체(frame-title 등)는 부모 문서에서 검사한다", () => {
    for (const sel of THIRD_PARTY_WIDGET_FRAMES) {
      expect(THIRD_PARTY_AD_EXCLUDE).not.toContain(sel);
    }
  });
});

describe("shouldSkipChildFrame — 하위 프레임 검사 제외", () => {
  it("화면에 그려지고 광고가 아닌 프레임은 검사한다", () => {
    expect(shouldSkipChildFrame({ parentSkipped: false, excluded: false, rendered: true })).toBe(false);
  });

  it("광고 제외 선택자에 맞는 프레임은 다른 출처라도 건너뛴다", () => {
    expect(shouldSkipChildFrame({ parentSkipped: false, excluded: true, rendered: true })).toBe(true);
  });

  it("화면에 그려지지 않는 프레임(display:none·0×0)은 건너뛴다", () => {
    expect(shouldSkipChildFrame({ parentSkipped: false, excluded: false, rendered: false })).toBe(true);
  });

  it("바깥 프레임을 건너뛰었으면 그 안의 프레임도 건너뛴다", () => {
    expect(shouldSkipChildFrame({ parentSkipped: true, excluded: false, rendered: true })).toBe(true);
  });
});

// ── 최상위 문서 axe 실행 실패 ──
// 가짜 Page/Frame — runAxeOnPage가 부르는 메서드만 흉내 낸다. axe.run 문자열 평가 때 run(frame)의
// 반환값을 쓰고, 던지면 Playwright evaluate 실패처럼 보인다.
const VIRTUAL_NODE_ERROR =
  'frame.evaluate: Error: VirtualNode class must have a "props" object consisting of "nodeType" and "nodeName" properties\n    at get props (eval at evaluate)';
const okRun = (): AxeRunResults => ({
  violations: [{ id: "image-alt", impact: "critical", tags: ["wcag2a", "wcag111"], helpUrl: "", nodes: [{ target: ["img"], html: "<img>", failureSummary: "" }] }],
  passes: [],
  incomplete: [],
});

type FakeFrame = { name: string; run: () => AxeRunResults };
function fakePage(frames: FakeFrame[]) {
  const pwFrames: Record<string, unknown>[] = [];
  for (const f of frames) {
    pwFrames.push({
      parentFrame: () => (f === frames[0] ? null : pwFrames[0]),
      frameElement: async () => {
        throw new Error("no element");
      },
      evaluate: async (fn: unknown) => {
        if (typeof fn === "function") return false; // 빈 문서 판정 — 빈 문서 아님
        if (typeof fn === "string" && fn.startsWith("window.axe.run(")) return f.run();
        return undefined; // axe 주입·로케일·등록 스크립트
      },
    });
  }
  return {
    url: () => "http://example.test/",
    evaluate: async () => ({ hasLang: true, hasTitle: true, bodyEmpty: false }),
    mainFrame: () => pwFrames[0],
    frames: () => pwFrames,
    waitForTimeout: async () => undefined,
  } as unknown as Page;
}

describe("runAxeOnPage — 최상위 문서 axe 실행 실패", () => {
  it("최상위 문서에서 axe가 매번 실패하면 위반 0이 아니라 AxeRunError를 던진다", async () => {
    let calls = 0;
    const page = fakePage([
      {
        name: "main",
        run: () => {
          calls++;
          throw new Error(VIRTUAL_NODE_ERROR);
        },
      },
    ]);
    const err = await runAxeOnPage(page, { settleAnimations: false }).catch((e) => e);
    expect(err).toBeInstanceOf(AxeRunError);
    expect(err.message).toContain('VirtualNode class must have a "props" object');
    expect(err.message).not.toContain("frame.evaluate:");
    expect(calls).toBe(2); // 한 번 다시 시도한 뒤 확정
  });

  it("첫 시도만 실패하면(일시적 실패) 다시 시도한 결과로 검사한다", async () => {
    let calls = 0;
    const page = fakePage([
      {
        name: "main",
        run: () => {
          if (calls++ === 0) throw new Error("frame.evaluate: Execution context was destroyed");
          return okRun();
        },
      },
    ]);
    const result = await runAxeOnPage(page, { settleAnimations: false, stabilityFilter: false });
    expect(result.violations.map((v) => v.ruleId)).toContain("image-alt");
  });

  it("하위 프레임 하나의 실패는 그 프레임만 건너뛰고 최상위 결과는 그대로 낸다", async () => {
    const page = fakePage([
      { name: "main", run: okRun },
      {
        name: "child",
        run: () => {
          throw new Error(VIRTUAL_NODE_ERROR);
        },
      },
    ]);
    const result = await runAxeOnPage(page, { settleAnimations: false, stabilityFilter: false });
    expect(result.violations.map((v) => v.ruleId)).toContain("image-alt");
  });
});

describe("axeErrorReason — 실패 사유 한 줄", () => {
  it("Playwright evaluate 접두어와 스택을 떼고 첫 줄만 남긴다", () => {
    expect(axeErrorReason(new Error(VIRTUAL_NODE_ERROR))).toBe(
      'Error: VirtualNode class must have a "props" object consisting of "nodeType" and "nodeName" properties',
    );
  });

  it("빈 메시지는 unknown", () => {
    expect(axeErrorReason(new Error(""))).toBe("unknown");
  });
});
