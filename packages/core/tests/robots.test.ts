import { describe, expect, it } from "vitest";
import { isPathAllowed, parseRobots } from "../src/security/robots";

describe("parseRobots", () => {
  it("와일드카드 그룹 규칙 파싱", () => {
    const rules = parseRobots(`
User-agent: *
Disallow: /admin
Allow: /admin/public
`);
    expect(rules.disallow).toEqual(["/admin"]);
    expect(rules.allow).toEqual(["/admin/public"]);
  });

  it("우리 UA 전용 그룹이 와일드카드보다 우선", () => {
    const rules = parseRobots(`
User-agent: *
Disallow: /

User-agent: a11ychk-bot
Disallow: /private
`);
    expect(rules.disallow).toEqual(["/private"]);
  });

  it("연속된 User-agent 줄은 한 그룹으로 묶임", () => {
    const rules = parseRobots(`
User-agent: googlebot
User-agent: *
Disallow: /x
`);
    expect(rules.disallow).toEqual(["/x"]);
  });

  it("주석·빈 줄 무시", () => {
    const rules = parseRobots(`# comment\n\nUser-agent: *\nDisallow: /a # trailing\n`);
    expect(rules.disallow).toEqual(["/a"]);
  });
});

describe("isPathAllowed", () => {
  it("규칙 없음 → 전체 허용", () => {
    expect(isPathAllowed({ disallow: [], allow: [] }, "/anything")).toBe(true);
  });

  it("Disallow 매칭 → 차단", () => {
    const rules = { disallow: ["/admin"], allow: [] };
    expect(isPathAllowed(rules, "/admin")).toBe(false);
    expect(isPathAllowed(rules, "/admin/users")).toBe(false);
    expect(isPathAllowed(rules, "/about")).toBe(true);
  });

  it("더 구체적인 Allow가 Disallow를 이김", () => {
    const rules = { disallow: ["/admin"], allow: ["/admin/public"] };
    expect(isPathAllowed(rules, "/admin/public/page")).toBe(true);
    expect(isPathAllowed(rules, "/admin/secret")).toBe(false);
  });

  it("와일드카드와 $ 앵커 지원", () => {
    const rules = { disallow: ["/*.pdf$"], allow: [] };
    expect(isPathAllowed(rules, "/file.pdf")).toBe(false);
    expect(isPathAllowed(rules, "/file.pdf.html")).toBe(true);
  });

  it("Disallow: / → 전체 차단", () => {
    expect(isPathAllowed({ disallow: ["/"], allow: [] }, "/")).toBe(false);
  });
});
