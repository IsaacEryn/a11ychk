import { describe, expect, it } from "vitest";
import { hasAuthCookie } from "@/lib/authCookie";

/**
 * AuthSync는 이 판별이 어긋나면 두 방향으로 사고가 난다:
 * 세션 쿠키를 놓치면 로그인 직후 무한 새로고침, code-verifier를 세션으로 오판하면
 * 낡은 헤더를 못 잡는다. 이름 규칙을 여기 못 박아 둔다.
 */
describe("hasAuthCookie", () => {
  it("세션 쿠키를 찾는다", () => {
    expect(hasAuthCookie("sb-jechfzgsxcejyemqemcy-auth-token=base64-eyJhbGci")).toBe(true);
  });

  it("분할 쿠키(.0/.1)도 세션이다", () => {
    expect(hasAuthCookie("sb-abc-auth-token.0=aaa; sb-abc-auth-token.1=bbb")).toBe(true);
  });

  it("다른 쿠키 뒤에 있어도 찾는다", () => {
    expect(hasAuthCookie("theme=dark; NEXT_LOCALE=ko; sb-abc-auth-token=v")).toBe(true);
  });

  it("로그인 진행 중의 code-verifier는 세션이 아니다", () => {
    expect(hasAuthCookie("sb-abc-auth-token-code-verifier=xyz")).toBe(false);
  });

  it("세션 쿠키가 없으면 false", () => {
    expect(hasAuthCookie("")).toBe(false);
    expect(hasAuthCookie("theme=dark; NEXT_LOCALE=ko")).toBe(false);
    // 값 안에 이름이 들어 있어도 쿠키 이름이 아니면 무시
    expect(hasAuthCookie("note=sb-abc-auth-token=fake")).toBe(false);
  });
});
