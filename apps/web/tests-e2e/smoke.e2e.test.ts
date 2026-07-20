/**
 * 웹 E2E 스모크 — 실제 크로미엄으로 실행 중인 앱을 검증한다.
 *  1) 공개 페이지가 치명적 오류 없이 렌더되는지 (무인증 — CI/로컬 공통)
 *  2) 보고서 view/std 토글이 클라이언트에서 즉시 필터되는지 (서버 재페치 없이)
 *     — E2E_REPORT_URL(선택 E2E_COOKIES)이 있을 때만 실행. 성능 개선(#100)의 실동작 검증.
 *
 * 전제: 앱이 E2E_BASE_URL(기본 http://localhost:3100)에서 동작. npx playwright install chromium.
 * vitest의 expect를 쓰므로 Playwright Locator 메서드(getAttribute/isVisible/count)로 단언한다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const REPORT_URL = process.env.E2E_REPORT_URL; // 로그인/토큰 보고서 URL (있을 때만 필터 검증)
const COOKIES = process.env.E2E_COOKIES; // "name=value; name2=value2" (선택)

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

function parseCookies(raw: string): { name: string; value: string; url: string }[] {
  return raw
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const i = c.indexOf("=");
      return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE_URL };
    });
}

describe("공개 페이지 스모크 (무인증)", () => {
  const paths = ["/ko", "/ko/guide", "/ko/accessibility", "/ko/directory", "/ko/login", "/en"];
  for (const path of paths) {
    it(`${path} — 치명적 오류 없이 렌더된다`, async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      const res = await page.goto(BASE_URL + path, { waitUntil: "domcontentloaded", timeout: 30_000 });
      expect(res, `${path} 응답 없음`).toBeTruthy();
      expect(res!.status(), `${path} 상태 ${res!.status()}`).toBeLessThan(400);
      // 헤더(레이아웃) + 페이지 콘텐츠가 존재
      expect(await page.locator("header").first().isVisible(), `${path} 헤더 없음`).toBe(true);
      expect(await page.locator("h1, h2, main").count(), `${path} 콘텐츠 없음`).toBeGreaterThan(0);
      // 앱 코드에서 던진 미처리 예외가 없어야 한다 (dev 하이드레이션 경고는 console.error라 제외)
      expect(pageErrors, `${path} pageerror: ${pageErrors.join(" | ")}`).toEqual([]);
      await context.close();
    });
  }
});

describe.runIf(!!REPORT_URL)("보고서 클라이언트 필터 (view 토글)", () => {
  it("자동 검사만 클릭 시 서버 재페치 없이 행이 필터된다", async () => {
    const context = await browser.newContext();
    if (COOKIES) await context.addCookies(parseCookies(COOKIES));
    const page = await context.newPage();

    await page.goto(REPORT_URL!, { waitUntil: "networkidle", timeout: 45_000 });
    const autoBtn = page.getByRole("button", { name: "자동 검사만", exact: true });
    await autoBtn.waitFor({ state: "visible", timeout: 15_000 });

    const wrapper = page.locator("[data-view]").first();
    expect(await wrapper.getAttribute("data-view")).toBe("all");
    const allRows = await page.locator("[data-row]:visible").count();
    expect(allRows).toBeGreaterThan(0);

    // 센티넬 — 전체 페이지 리로드가 일어나면 window가 초기화되어 사라진다.
    // history.replaceState(클라이언트 필터)는 framenavigated를 발생시키므로 그 신호는 쓰지 않는다.
    await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true; });
    await autoBtn.click();
    // 클라이언트 상태 반영 대기 (data-view=auto) — 서버 재렌더 없이 즉시 바뀌어야 함
    await page.waitForFunction(
      () => document.querySelector("[data-view]")?.getAttribute("data-view") === "auto",
      undefined,
      { timeout: 5_000 },
    );

    const autoRows = await page.locator("[data-row]:visible").count();
    expect(autoRows, "auto 보기 행 수가 all보다 적어야 한다").toBeLessThan(allRows);
    const survived = await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload === true);
    expect(survived, "토글은 전체 페이지 리로드(서버 재페치) 없이 동작해야 한다").toBe(true);
    expect(page.url()).toContain("view=auto"); // replaceState로만 URL 갱신

    await context.close();
  });
});
