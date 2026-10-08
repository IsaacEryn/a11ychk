"use server";

import { headers } from "next/headers";
import { getBillingFlags } from "@/lib/appSettings";
import { checkoutLocale, checkoutReturnUrls, parseCardChange, parseStartCheckout, requestOrigin } from "@/lib/billing/checkout";
import { billingMode, rowLivemode, tossKeys } from "@/lib/billing/config";
import { abandonOpenCheckouts, startCardChangeCheckout, startSubscribeCheckout, type StartOutcome } from "@/lib/billing/flows/start";
import { errorText } from "@/lib/billing/flows/subscribe";
import { createBillingDeps } from "@/lib/billing/server";
import type { BillingDeps } from "@/lib/billing/types";
import { loadViewer } from "@/lib/billing/viewer";
import { canCheckout } from "@/lib/billing/visibility";
import { actionLocale, requireUser } from "./shared";

/**
 * 사용자 결제 액션 — 결제 시도를 만들고 토스 결제창(SDK)에 넘길 값을 돌려준다. 결제창은 브라우저가 연다.
 * 클라이언트 키는 이 응답으로만 브라우저에 간다(NEXT_PUBLIC_ 환경변수를 두지 않는다). 시크릿 키·빌링키는 나가지 않는다.
 * 돌아올 주소는 요청 헤더로 만든다 — 폼이 보내는 값은 가격 id·구독 id·동의 체크뿐이고 금액은 서버가 가격 행에서 읽는다.
 */

export interface TossCheckoutSdk {
  clientKey: string;
  customerKey: string;
  successUrl: string;
  failUrl: string;
  customerEmail: string | null;
}

export type StartCheckoutError =
  | "invalid"
  | "consent"
  | "notAllowed"
  | "hasActive"
  | "priceInactive"
  | "notConfigured"
  | "inProgress"
  | "failed";

export interface StartCheckoutState {
  ok?: true;
  sdk?: TossCheckoutSdk;
  error?: StartCheckoutError;
}

type Ready = { ok: true; deps: BillingDeps; clientKey: string; livemode: boolean } | { ok: false; error: "notAllowed" | "notConfigured" };

/** 결제 모드·키 — off면 결제 없음(notAllowed), 키·암호화 키가 없으면 콜백에서 막히기 전에 멈춘다(notConfigured) */
function billingReady(): Ready {
  const livemode = rowLivemode(billingMode());
  if (livemode === null) return { ok: false, error: "notAllowed" };
  const keys = tossKeys();
  const deps = createBillingDeps();
  if (!keys || !deps) return { ok: false, error: "notConfigured" };
  return { ok: true, deps, clientKey: keys.clientKey, livemode };
}

/** 흐름 결과 → 결제창 값. 돌아올 주소가 이상하면(헤더 위조·잘못된 프록시) 결제 시도를 만들기 전에 멈춘다 */
async function toState(
  deps: BillingDeps,
  clientKey: string,
  email: string | null,
  run: (locale: ReturnType<typeof checkoutLocale>) => Promise<StartOutcome>,
): Promise<StartCheckoutState> {
  const origin = requestOrigin(await headers());
  if (!origin) {
    await deps.log("billing checkout refused: request origin is not a valid http(s) host");
    return { error: "failed" };
  }
  const locale = checkoutLocale(await actionLocale());
  let outcome: StartOutcome;
  try {
    outcome = await run(locale);
  } catch (e) {
    await deps.log(`billing start checkout failed: ${errorText(e)}`);
    return { error: "failed" };
  }
  if (!outcome.ok) return { error: outcome.error };
  return {
    ok: true,
    sdk: { clientKey, customerKey: outcome.customerKey, ...checkoutReturnUrls(origin, outcome.checkoutId, locale), customerEmail: email },
  };
}

/**
 * 새 구독 결제 시작 — 입력(가격 id·동의) → 결제 모드·키 → 공개 범위(canCheckout) → 흐름(가격·진행 중 구독·진행 중 시도·
 * 고객 키·시도·동의 기록) → 결제창 값.
 */
export async function startCheckout(_prev: StartCheckoutState, fd: FormData): Promise<StartCheckoutState> {
  const { supabase, user } = await requireUser();
  const input = parseStartCheckout(fd);
  if (!input.ok) return { error: input.error };
  const ready = billingReady();
  if (!ready.ok) return { error: ready.error };
  const mode = billingMode();
  const [viewer, flags] = await Promise.all([loadViewer(supabase, user.id), getBillingFlags(supabase)]);
  if (!canCheckout(mode, flags, viewer)) return { error: "notAllowed" };

  return toState(ready.deps, ready.clientKey, user.email ?? null, (locale) =>
    startSubscribeCheckout(ready.deps, { userId: user.id, livemode: ready.livemode, priceId: input.value.priceId, locale }),
  );
}

/**
 * 결제 카드 변경 시작 — 그 사용자의 진행 중 토스 구독일 때만. 공개 범위(canCheckout)는 보지 않는다: 새 가입을 닫아도
 * 이미 구독 중인 사람은 만료된 카드를 바꿀 수 있어야 한다(구독이 곧 결제 자격이다).
 */
export async function startCardChange(_prev: StartCheckoutState, fd: FormData): Promise<StartCheckoutState> {
  const { user } = await requireUser();
  const input = parseCardChange(fd);
  if (!input.ok) return { error: input.error };
  const ready = billingReady();
  if (!ready.ok) return { error: ready.error };

  return toState(ready.deps, ready.clientKey, user.email ?? null, () =>
    startCardChangeCheckout(ready.deps, { userId: user.id, livemode: ready.livemode, subscriptionId: input.value.subscriptionId }),
  );
}

export interface AbandonCheckoutState {
  ok?: true;
  error?: "notConfigured";
}

/**
 * 그만둔 결제 시도 닫기 — 결제창을 닫았거나 뒤로 가기로 돌아와 시도가 열린 채 남았을 때(그대로 두면 30분 동안
 * inProgress로 막힌다). 그 사용자·지금 모드의 선점 전(open) 시도만 닫는다. 입력은 받지 않는다.
 */
export async function abandonCheckout(): Promise<AbandonCheckoutState> {
  const { user } = await requireUser();
  const ready = billingReady();
  if (!ready.ok) return { error: "notConfigured" };
  await abandonOpenCheckouts(ready.deps, { userId: user.id, livemode: ready.livemode });
  return { ok: true };
}
