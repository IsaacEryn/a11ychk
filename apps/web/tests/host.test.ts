import { describe, expect, it } from "vitest";
import { foldHost, scanUrlMatchesHost } from "@/lib/host";

describe("foldHost", () => {
  it("www.만 접고 나머지 서브도메인은 유지", () => {
    expect(foldHost("www.codeslog.com")).toBe("codeslog.com");
    expect(foldHost("codeslog.com")).toBe("codeslog.com");
    expect(foldHost("WWW.CodesLog.com")).toBe("codeslog.com");
    expect(foldHost("blog.codeslog.com")).toBe("blog.codeslog.com"); // www 아닌 서브도메인은 보존
  });
});

describe("scanUrlMatchesHost", () => {
  it("www/apex 교차 매칭 (핵심 버그 케이스)", () => {
    // 등록 apex + www 검사 URL → 매칭
    expect(scanUrlMatchesHost("https://www.codeslog.com/", "codeslog.com")).toBe(true);
    // 등록 www + apex 검사 URL → 매칭
    expect(scanUrlMatchesHost("https://codeslog.com/path", "www.codeslog.com")).toBe(true);
    // 동일 → 매칭
    expect(scanUrlMatchesHost("https://codeslog.com/", "codeslog.com")).toBe(true);
  });

  it("다른 사이트·유사 도메인은 매칭하지 않음", () => {
    expect(scanUrlMatchesHost("https://blog.codeslog.com/", "codeslog.com")).toBe(false); // 다른 서브도메인
    expect(scanUrlMatchesHost("https://evilcodeslog.com/", "codeslog.com")).toBe(false); // 접미사 유사 오탐 방지
    expect(scanUrlMatchesHost("https://codeslog.com.attacker.com/", "codeslog.com")).toBe(false);
  });

  it("잘못된 URL은 false", () => {
    expect(scanUrlMatchesHost("not a url", "codeslog.com")).toBe(false);
    expect(scanUrlMatchesHost("", "codeslog.com")).toBe(false);
  });
});
