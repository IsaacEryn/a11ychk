import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { deferredMailer } from "../src/lib/billing/server";
import type { BillingMailer } from "../src/lib/billing/types";

/** csp.ts는 정책을 모듈을 읽을 때 한 번 만든다 — 환경변수마다 새로 읽는다 */
async function policyWith(mode: string | undefined): Promise<string> {
  vi.resetModules();
  vi.stubEnv("BILLING_MODE", mode ?? "");
  const { attachCspToRequest } = await import("../src/lib/security/csp");
  return attachCspToRequest({ headers: new Headers() } as unknown as NextRequest);
}

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("CSP — 토스 결제창 허용은 결제 모드일 때만", () => {
  it("결제 꺼짐(기본)이면 토스 출처가 없다", async () => {
    for (const mode of [undefined, "off", "prod"]) {
      expect(await policyWith(mode)).not.toContain("tosspayments.com");
    }
  });

  it.each(["test", "live", " test "])("BILLING_MODE=%s면 script·connect·frame·img·form-action에 토스를 연다", async (mode) => {
    const csp = await policyWith(mode);
    expect(directive(csp, "script-src")).toContain(" https://js.tosspayments.com");
    // strict-dynamic·nonce는 그대로
    expect(directive(csp, "script-src")).toMatch(/'nonce-[^']+' 'strict-dynamic'/);
    for (const name of ["connect-src", "frame-src", "img-src", "form-action"]) {
      expect(directive(csp, name)).toContain(" https://*.tosspayments.com");
    }
    expect(directive(csp, "form-action")).toBe("form-action 'self' https://*.tosspayments.com");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });
});

describe("deferredMailer — 메일을 응답 뒤로 미룬다", () => {
  it("send는 바로 돌아오고, 예약한 일을 실행해야 안쪽 메일러가 보낸다", async () => {
    const sent: unknown[][] = [];
    const inner: BillingMailer = {
      async send(...args) {
        sent.push(args);
      },
    };
    const tasks: Array<() => Promise<void>> = [];
    const mailer = deferredMailer(inner, (task) => tasks.push(task));

    await mailer.send("user-1", "receipt", { amount: 1234 });

    expect(sent).toHaveLength(0);
    expect(tasks).toHaveLength(1);
    await tasks[0]();
    expect(sent).toEqual([["user-1", "receipt", { amount: 1234 }]]);
  });

  it("예약 자체가 실패하면(요청 밖) 던진다 — 흐름의 sendBillingMail이 기록한다", async () => {
    const mailer = deferredMailer({ send: async () => undefined }, () => {
      throw new Error("after() called outside a request scope");
    });
    await expect(mailer.send("user-1", "receipt", {})).rejects.toThrow("outside a request scope");
  });
});
