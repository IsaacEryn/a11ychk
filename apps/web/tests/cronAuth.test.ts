import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAuthorizedCron } from "../src/lib/cronAuth";

const SECRET = "cron-secret-for-vitest";
const URL = "https://a11ychk.com/api/cron/scheduled-scans";

function req(authorization?: string): Request {
  return new Request(URL, {
    headers: authorization === undefined ? {} : { authorization },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("isAuthorizedCron — cron 엔드포인트 인증 경계", () => {
  it("정확한 Bearer 시크릿이면 통과", () => {
    expect(isAuthorizedCron(req(`Bearer ${SECRET}`))).toBe(true);
  });

  it("CRON_SECRET 미설정이면 어떤 요청도 거부 (Bearer undefined 매칭 포함)", () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCron(req(`Bearer ${SECRET}`))).toBe(false);
    expect(isAuthorizedCron(req("Bearer undefined"))).toBe(false);
    expect(isAuthorizedCron(req(""))).toBe(false);
  });

  it("같은 길이의 다른 시크릿은 거부 (timingSafeEqual 경로)", () => {
    const wrong = SECRET.slice(0, -1) + (SECRET.endsWith("x") ? "y" : "x");
    expect(wrong).toHaveLength(SECRET.length);
    expect(isAuthorizedCron(req(`Bearer ${wrong}`))).toBe(false);
  });

  it("길이가 다른 시크릿은 거부 (사전 길이 가드)", () => {
    expect(isAuthorizedCron(req(`Bearer ${SECRET}x`))).toBe(false);
    expect(isAuthorizedCron(req(`Bearer ${SECRET.slice(0, 3)}`))).toBe(false);
  });

  it("헤더 없음·빈 값은 거부", () => {
    expect(isAuthorizedCron(req())).toBe(false);
    expect(isAuthorizedCron(req(""))).toBe(false);
  });

  it("Bearer 접두 없이 시크릿만 보내면 거부", () => {
    expect(isAuthorizedCron(req(SECRET))).toBe(false);
    expect(isAuthorizedCron(req(`bearer ${SECRET}`))).toBe(false); // 소문자 접두도 불일치
  });
});
