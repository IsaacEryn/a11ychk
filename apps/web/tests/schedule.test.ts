import { describe, expect, it } from "vitest";
import { FREQUENCY_HOURS, dueIntervalHours, pickScheduledDomains, retryNextDayAt } from "@/lib/scan/schedule";

describe("dueIntervalHours — 정기 검사 주기 간격", () => {
  it("주기별 간격은 주기보다 약간 짧다 (드리프트로 하루씩 밀림 방지)", () => {
    expect(dueIntervalHours("daily")).toBe(20);
    expect(dueIntervalHours("weekly")).toBe(6.5 * 24);
    expect(dueIntervalHours("monthly")).toBe(27 * 24);
    expect(dueIntervalHours("weekly")).toBeLessThan(7 * 24);
    expect(dueIntervalHours("monthly")).toBeLessThan(30 * 24);
  });

  it("미지정·알 수 없는 값은 daily로 폴백 (0021 미적용 행 방어)", () => {
    expect(dueIntervalHours(undefined)).toBe(FREQUENCY_HOURS.daily);
    expect(dueIntervalHours(null)).toBe(FREQUENCY_HOURS.daily);
    expect(dueIntervalHours("hourly")).toBe(FREQUENCY_HOURS.daily);
    expect(dueIntervalHours(42)).toBe(FREQUENCY_HOURS.daily);
  });
});

describe("retryNextDayAt — 일시 실패 후 다음 날 크론이 다시 잡는 시각", () => {
  const NOW = Date.parse("2026-09-26T18:00:00Z");
  const DAY = 24 * 3600_000;

  for (const freq of ["daily", "weekly", "monthly"] as const) {
    it(`${freq}: 오늘 크론에는 대상이 아니고 내일 크론에는 대상`, () => {
      const last = Date.parse(retryNextDayAt(freq, NOW));
      const interval = dueIntervalHours(freq) * 3600_000;
      expect(NOW - last).toBeLessThan(interval);
      expect(NOW + DAY - last).toBeGreaterThanOrEqual(interval);
      // 크론 후보 쿼리의 최소 간격(daily) 조건도 통과
      expect(last).toBeLessThan(NOW + DAY - FREQUENCY_HOURS.daily * 3600_000);
    });
  }
});

describe("pickScheduledDomains — 크론이 정기 검사를 만들 도메인 고르기", () => {
  const H = 3600_000;
  const NOW = Date.parse("2026-09-26T18:00:00Z");
  const ago = (h: number) => new Date(NOW - h * H).toISOString();
  const dom = (id: string, user: string, last: string | null, freq = "daily") => ({
    id,
    user_id: user,
    last_auto_scan_at: last,
    scan_frequency: freq,
  });

  it("계정당 1개만, 나머지는 deferred로 집계", () => {
    const { picked, deferred } = pickScheduledDomains(
      [dom("a1", "A", null), dom("a2", "A", null), dom("b1", "B", ago(30))],
      NOW,
      20,
    );
    expect(picked.map((d) => d.id).sort()).toEqual(["a1", "b1"]);
    expect(deferred).toBe(1);
  });

  it("한 계정의 형제가 많아도 다른 계정이 밀리지 않는다", () => {
    const many = Array.from({ length: 50 }, (_, i) => dom(`a${i}`, "A", null));
    const { picked } = pickScheduledDomains([...many, dom("b1", "B", ago(25))], NOW, 20);
    expect(picked.map((d) => d.user_id).sort()).toEqual(["A", "B"]);
  });

  it("재시도 값은 오래 밀린 도메인을 앞지르지 않는다(기한 초과 시간 순)", () => {
    const weeklyRetried = dom("w", "W", retryNextDayAt("weekly", NOW - 24 * H), "weekly"); // 기한 초과 4h
    const daily = dom("d", "D", ago(30)); // 기한 초과 10h
    const { picked } = pickScheduledDomains([weeklyRetried, daily], NOW, 1);
    expect(picked.map((d) => d.id)).toEqual(["d"]);
  });

  it("기한 전인 도메인은 고르지 않는다", () => {
    expect(pickScheduledDomains([dom("w", "W", ago(48), "weekly")], NOW, 20).picked).toEqual([]);
  });

  it("30일 시뮬레이션: 같은 계정의 매일 도메인 둘은 번갈아 돈다(한쪽이 굶지 않음)", () => {
    const doms = [dom("d1", "A", null), dom("d2", "A", null)];
    const runs: Record<string, number> = { d1: 0, d2: 0 };
    for (let day = 0; day < 30; day++) {
      const t = NOW + day * 24 * H;
      for (const d of pickScheduledDomains(doms, t, 20).picked) {
        runs[d.id]++;
        d.last_auto_scan_at = new Date(t).toISOString();
      }
    }
    expect(runs).toEqual({ d1: 15, d2: 15 });
  });

  const simulate = (doms: ReturnType<typeof dom>[], days: number) => {
    const runs: Record<string, number[]> = Object.fromEntries(doms.map((d) => [d.id, []]));
    for (let day = 0; day < days; day++) {
      const t = NOW + day * 24 * H;
      for (const d of pickScheduledDomains(doms, t, 20).picked) {
        runs[d.id].push(day);
        d.last_auto_scan_at = new Date(t).toISOString();
      }
    }
    const maxGap = (xs: number[]) => Math.max(...xs.slice(1).map((x, i) => x - xs[i]));
    return { runs, maxGap };
  };

  it("혼합 주기: 매일+주간 계정의 주간 도메인은 8일 안에 돈다", () => {
    const { runs, maxGap } = simulate([dom("d", "A", null), dom("w", "A", null, "weekly")], 60);
    expect(maxGap(runs.w)).toBeLessThanOrEqual(8);
    expect(runs.d.length).toBeGreaterThanOrEqual(50);
  });

  it("혼합 주기: 매일×3+월간 계정의 월간 도메인은 31일 안에 돈다", () => {
    const { runs, maxGap } = simulate(
      [dom("d1", "A", null), dom("d2", "A", null), dom("d3", "A", null), dom("m", "A", null, "monthly")],
      120,
    );
    expect(maxGap(runs.m)).toBeLessThanOrEqual(31);
  });
});
