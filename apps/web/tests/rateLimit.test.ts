import { describe, expect, it } from "vitest";
import { allowRateLocal } from "../src/lib/rateLimit";

describe("allowRateLocal — 인메모리 폴백", () => {
  it("창 안에서 limit회까지 허용하고 그다음은 거절, 창이 지나면 다시 허용", () => {
    const t0 = 1_000_000;
    expect(allowRateLocal("k", 2, 1000, t0)).toBe(true);
    expect(allowRateLocal("k", 2, 1000, t0 + 10)).toBe(true);
    expect(allowRateLocal("k", 2, 1000, t0 + 20)).toBe(false);
    expect(allowRateLocal("k", 2, 1000, t0 + 1001)).toBe(true);
  });
});
