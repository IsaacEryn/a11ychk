import { describe, expect, it } from "vitest";
import { estimateWaitMinutes } from "@/lib/scan/queueEstimate";

describe("estimateWaitMinutes", () => {
  it("다음 차례(ahead=0)면 한 웨이브 = 평균 소요", () => {
    expect(estimateWaitMinutes(0, 3, 3)).toBe(3);
  });

  it("상한 내 대기는 여전히 한 웨이브", () => {
    // ahead=2, max=3 → ceil(3/3)=1 웨이브
    expect(estimateWaitMinutes(2, 3, 3)).toBe(3);
  });

  it("상한을 넘는 대기는 웨이브가 늘어난다", () => {
    // ahead=3, max=3 → ceil(4/3)=2 웨이브
    expect(estimateWaitMinutes(3, 3, 3)).toBe(6);
    // ahead=9, max=3 → ceil(10/3)=4 웨이브
    expect(estimateWaitMinutes(9, 3, 3)).toBe(12);
  });

  it("상한 1이면 앞선 수 + 자기 순번만큼 선형 증가", () => {
    expect(estimateWaitMinutes(0, 1, 3)).toBe(3);
    expect(estimateWaitMinutes(4, 1, 3)).toBe(15);
  });

  it("음수·소수 입력을 방어적으로 정규화한다", () => {
    expect(estimateWaitMinutes(-5, 3, 3)).toBe(3); // ahead<0 → 0
    expect(estimateWaitMinutes(2.9, 3, 3)).toBe(3); // floor(2.9)=2
    expect(estimateWaitMinutes(0, 0, 3)).toBe(3); // max<1 → 1
  });
});
