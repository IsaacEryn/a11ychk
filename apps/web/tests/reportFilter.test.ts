import { describe, it, expect } from "vitest";
import {
  wcagRowVisibleIn,
  kwcagRowVisibleIn,
  wcagRowData,
  kwcagRowData,
  type ReportView,
} from "../src/app/[locale]/scans/[id]/report/reportFilter";

const VIEWS: ReportView[] = ["all", "auto", "done", "issues"];

describe("wcagRowVisibleIn", () => {
  it("all 보기에서는 모든 행이 보인다", () => {
    for (const outcome of ["passed", "failed", "cannotTell", "notChecked", "notPresent"] as const) {
      expect(wcagRowVisibleIn("all", outcome, null)).toBe(true);
    }
  });

  it("auto: 자동 판정된 항목만(notChecked 제외), 리뷰와 무관", () => {
    expect(wcagRowVisibleIn("auto", "passed", null)).toBe(true);
    expect(wcagRowVisibleIn("auto", "failed", null)).toBe(true);
    expect(wcagRowVisibleIn("auto", "cannotTell", null)).toBe(true);
    expect(wcagRowVisibleIn("auto", "notPresent", null)).toBe(true);
    expect(wcagRowVisibleIn("auto", "notChecked", null)).toBe(false);
    // 리뷰가 있어도 auto는 자동 outcome 기준
    expect(wcagRowVisibleIn("auto", "notChecked", { outcome: "failed" })).toBe(false);
  });

  it("issues: 유효 판정이 failed인 항목 (리뷰가 자동을 덮어씀)", () => {
    expect(wcagRowVisibleIn("issues", "failed", null)).toBe(true);
    expect(wcagRowVisibleIn("issues", "passed", null)).toBe(false);
    // 리뷰가 failed로 덮으면 표시
    expect(wcagRowVisibleIn("issues", "passed", { outcome: "failed" })).toBe(true);
    // 리뷰가 passed로 덮으면 숨김 (자동은 failed였어도)
    expect(wcagRowVisibleIn("issues", "failed", { outcome: "passed" })).toBe(false);
  });

  it("done: 리뷰가 있거나 자동 확정(passed/failed/cannotTell)된 항목", () => {
    expect(wcagRowVisibleIn("done", "passed", null)).toBe(true);
    expect(wcagRowVisibleIn("done", "failed", null)).toBe(true);
    expect(wcagRowVisibleIn("done", "cannotTell", null)).toBe(true);
    expect(wcagRowVisibleIn("done", "notChecked", null)).toBe(false);
    expect(wcagRowVisibleIn("done", "notPresent", null)).toBe(false);
    // 리뷰가 있으면 미확정이라도 표시
    expect(wcagRowVisibleIn("done", "notChecked", { outcome: "failed" })).toBe(true);
  });
});

describe("kwcagRowVisibleIn", () => {
  it("all 보기에서는 모든 행이 보인다", () => {
    for (const status of ["pass", "fail", "review", "manual", "not-applicable"]) {
      expect(kwcagRowVisibleIn("all", status, null)).toBe(true);
    }
  });

  it("auto: 자동 판정된 항목만(manual 제외)", () => {
    expect(kwcagRowVisibleIn("auto", "pass", null)).toBe(true);
    expect(kwcagRowVisibleIn("auto", "fail", null)).toBe(true);
    expect(kwcagRowVisibleIn("auto", "review", null)).toBe(true);
    expect(kwcagRowVisibleIn("auto", "manual", null)).toBe(false);
  });

  it("리뷰 없음 — issues: fail만, done: pass/fail/review", () => {
    expect(kwcagRowVisibleIn("issues", "fail", null)).toBe(true);
    expect(kwcagRowVisibleIn("issues", "pass", null)).toBe(false);
    expect(kwcagRowVisibleIn("issues", "manual", null)).toBe(false);
    expect(kwcagRowVisibleIn("done", "pass", null)).toBe(true);
    expect(kwcagRowVisibleIn("done", "fail", null)).toBe(true);
    expect(kwcagRowVisibleIn("done", "review", null)).toBe(true);
    expect(kwcagRowVisibleIn("done", "manual", null)).toBe(false);
    expect(kwcagRowVisibleIn("done", "not-applicable", null)).toBe(false);
  });

  it("리뷰 있음 — issues는 리뷰 failed일 때만, done은 항상 표시", () => {
    expect(kwcagRowVisibleIn("issues", "manual", { outcome: "failed" })).toBe(true);
    expect(kwcagRowVisibleIn("issues", "manual", { outcome: "passed" })).toBe(false);
    expect(kwcagRowVisibleIn("done", "manual", { outcome: "passed" })).toBe(true);
    expect(kwcagRowVisibleIn("auto", "manual", { outcome: "failed" })).toBe(false); // auto는 리뷰 무관
  });
});

describe("wcagRowData / kwcagRowData — data 속성 직렬화", () => {
  it("data-row는 항상 빈 문자열, all 전용 속성은 없음", () => {
    const d = wcagRowData("failed", null);
    expect(d["data-row"]).toBe("");
    // failed는 auto·done·issues 전부 해당 → 속성이 빈 문자열로 존재
    expect(d["data-v-auto"]).toBe("");
    expect(d["data-v-done"]).toBe("");
    expect(d["data-v-issues"]).toBe("");
  });

  it("보이지 않는 view의 속성은 undefined (React가 속성 미출력)", () => {
    // passed 행: auto·done엔 보이나 issues엔 안 보임
    const d = wcagRowData("passed", null);
    expect(d["data-v-auto"]).toBe("");
    expect(d["data-v-done"]).toBe("");
    expect(d["data-v-issues"]).toBeUndefined();
  });

  it("kwcag manual 행: 리뷰 없으면 auto/done/issues 전부 미표시", () => {
    const d = kwcagRowData("manual", null);
    expect(d["data-row"]).toBe("");
    expect(d["data-v-auto"]).toBeUndefined();
    expect(d["data-v-done"]).toBeUndefined();
    expect(d["data-v-issues"]).toBeUndefined();
  });

  it("data 속성이 브라우저 실측(all=88·auto=28·done=22 필터)과 같은 규칙을 따른다", () => {
    // 각 view에서 보이는지 = 해당 data-v-* 속성이 정의됨과 동치
    for (const view of VIEWS.filter((v) => v !== "all")) {
      const outcome = "cannotTell";
      const visible = wcagRowVisibleIn(view, outcome, null);
      const attr = wcagRowData(outcome, null)[`data-v-${view}` as "data-v-auto"];
      expect(visible).toBe(attr === "");
    }
  });
});
