import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { billingMode, tossKeys } from "@/lib/billing/config";
import { loadEncKey } from "@/lib/billing/crypto";
import { sendBillingEmail, type BillingEmailData } from "@/lib/billing/emails";
import { createSupabaseBillingStore } from "@/lib/billing/store";
import { createTossClient } from "@/lib/billing/toss";
import type { BillingDeps, BillingEmailKind, BillingMailer } from "@/lib/billing/types";
import { logAppError } from "@/lib/logs";
import { mailLocale } from "@/lib/profileLocale";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 결제 흐름의 실제 의존성 조립 — 라우트·서버 액션·크론이 쓴다.
 * 모드가 off이거나 토스 키·암호화 키가 없으면 null: 결제사 호출 전에 멈춘다(notConfigured).
 */

export { createSupabaseBillingStore };

/** notify.ts와 같은 규칙 — 메일의 모든 주소는 절대 주소여야 버튼이 남는다 */
const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";

export interface BillingRecipient {
  email: string;
  locale: "ko" | "en";
}

/**
 * 메일 수신자 — auth 이메일 + profiles.locale. 이메일이 없으면(탈퇴 등) null.
 * 조회가 오류를 돌려주면 던진다(메일러가 기록하고 건너뛴다). 오류 문구에는 코드만 넣는다 —
 * 수신자 정보가 기록에 섞이지 않게.
 */
export async function loadRecipient(admin: SupabaseClient, userId: string): Promise<BillingRecipient | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) throw new Error(`recipient auth lookup failed (${error.code ?? error.status ?? "unknown"})`);
  const email = data?.user?.email;
  if (!email) return null;
  const { data: profile, error: profileError } = await admin.from("profiles").select("locale").eq("id", userId).maybeSingle();
  if (profileError) throw new Error(`recipient profile lookup failed (${profileError.code ?? "unknown"})`);
  return { email, locale: mailLocale(profile?.locale) };
}

type SendFn = (to: string, kind: BillingEmailKind, data: BillingEmailData[BillingEmailKind], opts: { locale: "ko" | "en"; test: boolean }) => Promise<boolean>;

/**
 * 결제 메일러 — 흐름이 준 내용에 수신자 언어의 관리·요금제 주소를 붙여 보낸다.
 * 수신자 조회·발송 실패는 log만 남기고 삼킨다(메일 때문에 결제 흐름이 멈추면 안 된다).
 * 기록에는 이메일 주소를 넣지 않는다.
 */
export function createBillingMailer(
  admin: SupabaseClient,
  log: (message: string) => Promise<void>,
  send: SendFn = sendBillingEmail,
): BillingMailer {
  return {
    async send(userId, kind, data) {
      if (!userId) return;
      try {
        const to = await loadRecipient(admin, userId);
        if (!to) return;
        const base = siteUrl();
        const full = {
          ...data,
          manageUrl: `${base}/${to.locale}/mypage/billing`,
          pricingUrl: `${base}/${to.locale}/pricing`,
        } as unknown as BillingEmailData[BillingEmailKind];
        const sent = await send(to.email, kind, full, { locale: to.locale, test: billingMode() === "test" });
        if (!sent) await log(`billing mail not sent: ${kind} for user ${userId}`);
      } catch (e) {
        await log(`billing mail failed: ${kind} for user ${userId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

export function createBillingDeps(): BillingDeps | null {
  if (billingMode() === "off") return null;
  const keys = tossKeys();
  if (!keys) return null;
  const encKey = loadEncKey();
  if (!encKey) return null;
  const admin = createAdminClient();
  const log = (message: string) => logAppError(admin, message, { path: "billing" });
  return {
    store: createSupabaseBillingStore(admin),
    toss: createTossClient(keys.secretKey),
    encKey,
    mailer: createBillingMailer(admin, log),
    now: () => Date.now(),
    log,
  };
}
