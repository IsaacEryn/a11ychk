import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkQuota } from "../src/lib/quota";

/** 호출을 기록하는 PostgREST 쿼리 빌더 스텁 — await하면 { count, error }로 끝난다 */
function recordingDb(count: number) {
  const calls: [string, unknown[]][] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "gte", "in"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ count, error: null }).then(resolve);
  const db = { from: (t: string) => (calls.push(["from", [t]]), builder) } as unknown as SupabaseClient;
  return { db, calls };
}

describe("checkQuota", () => {
  it("사용자가 직접 만든 검사(source='user')만 센다 — 정기·확장 보고서는 제외", async () => {
    const { db, calls } = recordingDb(0);
    await checkQuota(db, "u1", { daily: 3, weekly: 5, monthly: 10 });
    expect(calls).toContainEqual(["eq", ["source", "user"]]);
    expect(calls).toContainEqual(["eq", ["admin_retry", false]]);
    expect(calls.some(([m, a]) => m === "neq" && a[0] === "source")).toBe(false);
  });
  it("한도에 닿으면 초과 창을 알려 준다", async () => {
    const { db } = recordingDb(3);
    const r = await checkQuota(db, "u1", { daily: 3, weekly: 5, monthly: 10 });
    expect(r).toMatchObject({ ok: false, exceeded: "daily" });
  });
});
