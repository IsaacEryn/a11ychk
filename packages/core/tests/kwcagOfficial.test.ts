import { describe, expect, it } from "vitest";
import {
  KWCAG_BY_KSNO,
  KWCAG_ITEMS,
  kwcagLabel,
  kwcagNoLabel,
  kwcagNoListLabel,
} from "../src/catalog/kwcag";

/**
 * KS X OT0003:2022 「한국형 웹 콘텐츠 접근성 지침 2.2」 본문에서 옮긴 33개 검사항목.
 * 출처: 국립전파연구원 방송통신표준자료실 게시본(방송통신표준심의회 2022-12-28 개정)
 * https://www.rra.go.kr/ko/reference/kcsList_view.do?nb_seq=5247&nb_type=6
 * 일련번호는 웹 접근성 품질인증 심사의 1~33 번호다(같은 순서).
 * 표준이 개정되기 전에는 고치지 않는다.
 */
const OFFICIAL: [number, string, string, string, string][] = [
  [1, "5.1.1", "alternative-text", "적절한 대체 텍스트 제공", "perceivable"],
  [2, "5.2.1", "captions-for-multimedia", "자막 제공", "perceivable"],
  [3, "5.3.1", "table-structure", "표의 구성", "perceivable"],
  [4, "5.3.2", "meaningful-sequence", "콘텐츠의 선형구조", "perceivable"],
  [5, "5.3.3", "clear-instructions", "명확한 지시사항 제공", "perceivable"],
  [6, "5.4.1", "content-not-relying-on-color-alone", "색에 무관한 콘텐츠 인식", "perceivable"],
  [7, "5.4.2", "no-auto-play", "자동 재생 금지", "perceivable"],
  [8, "5.4.3", "text-contrast", "텍스트 콘텐츠의 명도 대비", "perceivable"],
  [9, "5.4.4", "distinguishable-content", "콘텐츠 간의 구분", "perceivable"],
  [10, "6.1.1", "keyboard-accessible", "키보드 사용 보장", "operable"],
  [11, "6.1.2", "focus-order-and-visibility", "초점 이동과 표시", "operable"],
  [12, "6.1.3", "target-size", "조작 가능", "operable"],
  [13, "6.1.4", "character-key-shortcuts", "문자 단축키", "operable"],
  [14, "6.2.1", "adjustable-time-limits", "응답시간 조절", "operable"],
  [15, "6.2.2", "pause-stop-hide", "정지 기능 제공", "operable"],
  [16, "6.3.1", "no-flashing-content", "깜빡임과 번쩍임 사용 제한", "operable"],
  [17, "6.4.1", "skip-repeated-blocks", "반복 영역 건너뛰기", "operable"],
  [18, "6.4.2", "page-frame-and-content-titles", "제목 제공", "operable"],
  [19, "6.4.3", "meaningful-link-text", "적절한 링크 텍스트", "operable"],
  [20, "6.4.4", "consistent-reference-locators", "고정된 참조 위치 정보", "operable"],
  [21, "6.5.1", "single-pointer-gestures", "단일 포인터 입력 지원", "operable"],
  [22, "6.5.2", "pointer-cancellation", "포인터 입력 취소", "operable"],
  [23, "6.5.3", "label-in-name", "레이블과 네임", "operable"],
  [24, "6.5.4", "motion-actuation", "동작기반 작동", "operable"],
  [25, "7.1.1", "language-of-page", "기본 언어 표시", "understandable"],
  [26, "7.2.1", "no-change-of-context-without-request", "사용자 요구에 따른 실행", "understandable"],
  [27, "7.2.2", "consistent-help", "찾기 쉬운 도움 정보", "understandable"],
  [28, "7.3.1", "error-identification", "오류 정정", "understandable"],
  [29, "7.3.2", "labels-for-inputs", "레이블 제공", "understandable"],
  [30, "7.3.3", "accessible-authentication", "접근 가능한 인증", "understandable"],
  [31, "7.3.4", "redundant-entry", "반복 입력 정보", "understandable"],
  [32, "8.1.1", "valid-markup", "마크업 오류 방지", "robust"],
  [33, "8.2.1", "aria-accessibility", "웹 애플리케이션 접근성 준수", "robust"],
];

describe("KS X OT0003:2022 원문 대조", () => {
  it("33개 항목의 일련번호·공식 번호·슬러그·이름·원칙이 원문 순서와 같다", () => {
    expect(KWCAG_ITEMS.map((i) => [i.serial, i.ksNo, i.slug, i.name.ko, i.principle])).toEqual(OFFICIAL);
  });

  it("일련번호는 배열 순서와 같다", () => {
    KWCAG_ITEMS.forEach((item, idx) => expect(item.serial).toBe(idx + 1));
  });

  it("공식 번호로 항목을 찾는다", () => {
    for (const item of KWCAG_ITEMS) expect(KWCAG_BY_KSNO.get(item.ksNo)).toBe(item);
  });

  it("2.2 신설 표시는 해설의 신규 9개와 같다", () => {
    expect(KWCAG_ITEMS.filter((i) => i.addedIn22).map((i) => i.ksNo)).toEqual([
      "6.1.4", "6.4.4", "6.5.1", "6.5.2", "6.5.3", "6.5.4", "7.2.2", "7.3.3", "7.3.4",
    ]);
  });
});

describe("표시 라벨", () => {
  const contrast = KWCAG_BY_KSNO.get("5.4.3")!;
  const labels = KWCAG_BY_KSNO.get("7.3.2")!;

  it("kwcagNoLabel — 「검사항목 8」", () => {
    expect(kwcagNoLabel(contrast, "ko")).toBe("검사항목 8");
    expect(kwcagNoLabel(contrast, "en")).toBe("Checkpoint 8");
  });

  it("kwcagLabel — 번호와 이름", () => {
    expect(kwcagLabel(contrast, "ko")).toBe("검사항목 8 텍스트 콘텐츠의 명도 대비");
    expect(kwcagLabel(contrast, "en")).toBe("Checkpoint 8 Text contrast");
  });

  it("kwcagNoListLabel — 여러 항목", () => {
    expect(kwcagNoListLabel([contrast, labels], "ko")).toBe("검사항목 8·29");
    expect(kwcagNoListLabel([contrast, labels], "en")).toBe("Checkpoints 8, 29");
    expect(kwcagNoListLabel([contrast], "en")).toBe("Checkpoint 8");
    expect(kwcagNoListLabel([], "ko")).toBe("");
  });
});
