// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BASE_SCRIPT } from "../src/scanner/customChecks";
import { collectPageSignals } from "../../../apps/extension/src/injected";
import type { PageCheckSignals } from "../src/scanner/pageChecks";

/**
 * 드리프트 방지 골든 테스트 — 서버 스캐너(BASE_SCRIPT 문자열)와 크롬 확장
 * (collectPageSignals 함수)은 같은 DOM에서 동일한 PageCheckSignals를
 * 계산해야 한다. 한쪽만 수정하면 이 테스트가 깨진다.
 */

const FIXTURE = `
  <nav><a href="#main">본문 바로가기</a><a href="/about">여기</a></nav>
  <main id="main">
    <img alt="banner.png" src="/x.png" />
    <img alt="이미지" src="/y.png" />
    <img alt="회사 연혁을 담은 연대표" src="/z.png" />
    <video autoplay src="/v.mp4"></video>
    <video src="/w.mp4"></video>
    <a href="/detail" target="_blank">자세히 보기</a>
    <a href="/pop" target="_blank" aria-label="새 창에서 열림">팝업 안내</a>
    <div onclick="go()">클릭 영역</div>
    <span onclick="go()" role="button" tabindex="0">버튼 역할</span>
    <button>확인</button>
  </main>
`;

function runBoth(): { server: PageCheckSignals; extension: PageCheckSignals } {
  document.body.innerHTML = FIXTURE;
  // BASE_SCRIPT는 페이지 컨텍스트 평가용 IIFE 문자열 — 동일 DOM에서 eval
  const server = eval(BASE_SCRIPT) as PageCheckSignals;
  document.body.innerHTML = FIXTURE; // 동일 초기 상태에서 확장 수집기 실행
  const extension = collectPageSignals();
  return { server, extension };
}

describe("서버 BASE_SCRIPT ↔ 확장 collectPageSignals 패리티", () => {
  it("같은 DOM에서 같은 신호 키 집합을 반환", () => {
    const { server, extension } = runBoth();
    expect(Object.keys(server).sort()).toEqual(Object.keys(extension).sort());
  });

  it("스칼라 신호 값이 일치 (미디어·건너뛰기·새창·링크·자막)", () => {
    const { server, extension } = runBoth();
    const scalarKeys = [
      "hasMedia",
      "hasNav",
      "skipLinkPresent",
      "videoNoTrack",
      "blankNoNotice",
      "genericLinks",
      "altSampled",
      "focusSampled",
      "focusNoOutline",
      "targetSampled",
    ] as const;
    for (const k of scalarKeys) {
      expect(server[k], `신호 "${k}" 불일치 — 서버/확장 수집기가 갈라졌습니다`).toEqual(extension[k]);
    }
  });

  it("배열 신호 길이가 일치 (대체텍스트·자동재생·클릭핸들러·작은타깃)", () => {
    const { server, extension } = runBoth();
    const arrayKeys = ["altFilename", "altGeneric", "autoplay", "inlineClickNonInteractive", "smallTargets"] as const;
    for (const k of arrayKeys) {
      expect(server[k].length, `배열 신호 "${k}" 개수 불일치`).toBe(extension[k].length);
    }
  });

  it("픽스처의 기대 판정 값 (양쪽 모두)", () => {
    const { server, extension } = runBoth();
    for (const s of [server, extension]) {
      expect(s.hasMedia).toBe(true);
      expect(s.hasNav).toBe(true);
      expect(s.skipLinkPresent).toBe(true); // "#main" 앵커
      expect(s.videoNoTrack).toBe(2); // track 없는 video 2개
      expect(s.blankNoNotice).toBe(1); // "자세히 보기"만 고지 없음
      expect(s.genericLinks).toBe(2); // "여기" + "자세히 보기"
      expect(s.altFilename.length).toBe(1); // banner.png
      expect(s.altGeneric.length).toBe(1); // "이미지"
      expect(s.autoplay.length).toBe(1); // muted 없는 autoplay
      expect(s.inlineClickNonInteractive.length).toBe(1); // div[onclick]만 (role 있는 span 제외)
    }
  });
});
