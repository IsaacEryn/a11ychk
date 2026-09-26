import { describe, expect, it } from "vitest";
import { parseRobots } from "@a11ychk/core";
import { filterPagesByRobots } from "@/lib/scan/manualRobots";

describe("filterPagesByRobots — 직접 입력 표본의 robots.txt 적용", () => {
  const pages = ["https://ex.com/", "https://ex.com/admin/users", "https://ex.com/blog?p=1"];

  it("a11ychk-bot 그룹의 Disallow를 따른다", () => {
    const r = filterPagesByRobots(pages, parseRobots("User-agent: a11ychk-bot\nDisallow: /admin"));
    expect(r.allowed).toEqual(["https://ex.com/", "https://ex.com/blog?p=1"]);
    expect(r.skipped).toBe(1);
  });

  it("전부 막으면 허용 0개", () => {
    const r = filterPagesByRobots(pages, parseRobots("User-agent: *\nDisallow: /"));
    expect(r.allowed).toEqual([]);
    expect(r.skipped).toBe(3);
  });

  it("쿼리까지 포함해 판정한다", () => {
    const r = filterPagesByRobots(pages, parseRobots("User-agent: *\nDisallow: /blog?p="));
    expect(r.allowed).not.toContain("https://ex.com/blog?p=1");
  });

  it("robots.txt가 없으면(빈 규칙) 전부 허용", () => {
    expect(filterPagesByRobots(pages, parseRobots("")).skipped).toBe(0);
  });

  it("해석할 수 없는 주소는 뺀다", () => {
    expect(filterPagesByRobots(["not a url"], parseRobots("")).allowed).toEqual([]);
  });
});
