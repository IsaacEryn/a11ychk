/**
 * 처리되지 않은 서버 오류의 기록과 관리자 알림 — instrumentation.onRequestError가 부른다.
 *
 * app_errors(migration 0008)에 기록하고, 24시간 안에 처음 보는 오류면 관리자에게 메일을 보낸다
 * (ADMIN_ALERT_EMAIL + RESEND_API_KEY 설정 시). 어떤 실패도 원래 요청 처리에 영향을 주지 않는다.
 *
 * instrumentation은 Node·Edge 양쪽에서 로드되므로 이 파일은 fetch만 쓴다(supabase-js·Node 전용 모듈 없음).
 */
import type { Instrumentation } from "next";
import { adminBasePath } from "./adminSlug";

type ErrorRequest = Parameters<Instrumentation.onRequestError>[1];
type ErrorContext = Parameters<Instrumentation.onRequestError>[2];

/** 테스트에서 바꿔 끼우는 바깥 의존성 */
export interface ReportDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
}

/** 조회·기록·메일 요청 하나의 시간 제한 — Next가 이 훅을 기다리므로 저장소나 메일이 느릴 때 오래 붙잡히지 않게 한다 */
const REQUEST_TIMEOUT_MS = 4000;

/** 경로를 이루는 글자 — 앞에 이 글자가 붙어 있으면 더 긴 경로의 뒷부분이라 떼지 않는다 */
const PATH_CHAR = "[\\w\\-./%~]";
/** 뒤로 경로가 이어지지 않는 곳 — 문장 끝의 마침표는 경로가 아니지만, 마침표 뒤로 이름이 이어지면(/x.png) 다른 경로다 */
const NOT_CONTINUED = "(?![\\w\\-/%~]|\\.[\\w\\-./%~])";
/** 이보다 긴 경로는 떼지 않는다 — 정규식 크기 한계(약 32,000자)를 넘으면 만들 때 던진다 */
const MAX_PATH_LENGTH = 2000;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 요청 경로가 메시지에 실릴 수 있는 모양들. 요청 경로는 퍼센트 인코딩돼 오지만 Next는 메시지에 푼 경로를 쓴다 —
 * 세그먼트마다 decodeURIComponent로 풀고 구분자(/ # ?)만 다시 인코딩한다(next의 decodePathParams).
 */
function pathForms(requestPath: string): string[] {
  const pathname = requestPath.split(/[?#]/)[0];
  const forms = new Set([requestPath, pathname]);
  const tryAdd = (decode: () => string) => {
    try {
      forms.add(decode());
    } catch {
      // 잘못된 인코딩 — 그 모양은 건너뛴다
    }
  };
  tryAdd(() => decodeURI(requestPath));
  tryAdd(() => decodeURI(pathname));
  tryAdd(() =>
    pathname
      .split("/")
      .map((segment) => decodeURIComponent(segment).replace(/[/#?]/g, encodeURIComponent))
      .join("/"),
  );
  // 긴 것부터 — 검색어가 붙은 경로를 먼저 떼야 검색어만 남지 않는다
  return [...forms].filter((form) => form.length >= 2 && form.length <= MAX_PATH_LENGTH).sort((a, b) => b.length - a.length);
}

/**
 * 오류 메시지에서 요청 경로를 `<path>`로 바꾼다.
 *
 * 중복 판정이 메시지로 이뤄지는데, Next의 "Page changed from static to dynamic at runtime /favicon.ico …"처럼
 * 메시지에 요청 경로가 박히는 오류는 주소마다 새 오류로 취급돼 봇이 찌른 주소 수만큼 메일이 나갔다.
 * 경로는 path 컬럼에, 원문은 스택 첫 줄에 남으므로 잃는 정보가 없다. 요청 경로와 정확히 같은 부분만 바꾼다 —
 * 넓게 바꾸면 서로 다른 오류가 하나로 합쳐진다.
 */
export function normalizeErrorMessage(message: string, requestPath: string): string {
  // 루트는 건드리지 않는다 — 메시지의 모든 슬래시가 바뀐다
  if (requestPath.split(/[?#]/)[0].length < 2) return message;
  try {
    return pathForms(requestPath).reduce(
      (out, form) => out.replace(new RegExp(`(?<!${PATH_CHAR})${escapeRegExp(form)}${NOT_CONTINUED}`, "g"), "<path>"),
      message,
    );
  } catch {
    // 떼지 못해도 기록은 남아야 한다
    return message;
  }
}

export interface AlertEmailInput {
  /** 경로를 뗀 메시지 */
  message: string;
  method: string;
  path: string;
  /** 관리자 콘솔의 로그 화면 주소 */
  logsUrl: string;
  routePath?: string;
  routeType?: string;
  renderSource?: string;
  userAgent?: string;
  digest?: string;
  commit?: string;
  deployEnv?: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * 알림 메일 — 봇이 찌른 주소인지 우리 라우트의 결함인지 메일만 보고 가릴 수 있게 라우트·user-agent·배포를 싣는다.
 * 경로와 user-agent는 요청에서 온 값이라 전부 이스케이프한다.
 */
export function buildAlertEmail(input: AlertEmailInput): { subject: string; html: string } {
  const line = (label: string, value: string | undefined, max: number) =>
    value ? `\n  <p style="margin:4px 0 0"><b>${label}</b>: <code>${escapeHtml(value.slice(0, max))}</code></p>` : "";
  const route = [input.routePath, input.routeType, input.renderSource].filter(Boolean).join(" · ");
  const deploy = [input.deployEnv, input.commit?.slice(0, 7)].filter(Boolean).join(" · ");
  const subject = `[A11y Check] 새 서버 오류: ${input.message.replace(/\s+/g, " ").slice(0, 80)}`;
  const html = `
<div style="font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1c2422;font-size:14px;line-height:1.6">
  <p style="font-weight:700;margin:0 0 12px">처리되지 않은 서버 오류가 새로 발생했습니다.</p>${line("경로", `${input.method} ${input.path}`, 300)}${line("라우트", route || undefined, 200)}${line("User-Agent", input.userAgent, 200)}${line("배포", deploy || undefined, 60)}${line("digest", input.digest, 60)}
  <p style="margin:8px 0 0"><b>메시지</b>:</p>
  <pre style="margin:4px 0 0;padding:10px;background:#f5f3ee;border-radius:6px;white-space:pre-wrap;word-break:break-all">${escapeHtml(input.message.slice(0, 600))}</pre>
  <p style="margin:16px 0 0"><a href="${escapeHtml(input.logsUrl)}" style="color:#0b5d54;font-weight:700">관리자 콘솔에서 확인 →</a></p>
  <p style="margin:12px 0 0;font-size:12px;color:#5d6a66">같은 오류는 24시간에 한 번만 알립니다. 요청 경로만 다른 오류는 같은 오류로 봅니다.</p>
</div>`;
  return { subject, html };
}

/** app_errors REST 접근 — supabase-js 없이 직접 부른다(instrumentation을 가볍게 유지) */
function appErrors(deps: ReportDeps, supabaseUrl: string, serviceKey: string) {
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
  return {
    /** 같은 메시지가 최근 24시간에 없으면 true. 조회에 실패하면 false — 저장소가 죽었을 때 오류마다 메일이 나가지 않게 */
    async isFirstIn24h(message: string): Promise<boolean> {
      try {
        const since = new Date(Date.now() - 24 * 3600_000).toISOString();
        const res = await deps.fetch(
          `${supabaseUrl}/rest/v1/app_errors?select=id&limit=1&message=eq.${encodeURIComponent(message)}&created_at=gt.${encodeURIComponent(since)}`,
          { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        );
        if (!res.ok) return false;
        return ((await res.json()) as unknown[]).length === 0;
      } catch {
        return false;
      }
    },
    async insert(row: Record<string, string | null>): Promise<void> {
      try {
        await deps.fetch(`${supabaseUrl}/rest/v1/app_errors`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", prefer: "return=minimal" },
          body: JSON.stringify(row),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        // 기록 실패 — 남길 곳이 없다
      }
    },
  };
}

/** 메일 발송 — 성공하거나 메일 설정이 없으면 null, 실패하면 이유(상태코드나 오류 이름) */
async function sendAlert(deps: ReportDeps, input: AlertEmailInput): Promise<string | null> {
  const to = deps.env.ADMIN_ALERT_EMAIL;
  const resendKey = deps.env.RESEND_API_KEY;
  if (!to || !resendKey) return null;
  try {
    const res = await deps.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "A11y Check <noreply@a11ychk.com>", to, ...buildAlertEmail(input) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return res.ok ? null : `HTTP ${res.status}`;
  } catch (e) {
    return e instanceof Error ? e.name : "unknown";
  }
}

const firstHeader = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * 실행 환경의 설정. process.env를 통째로 넘기지 않고 이름을 하나씩 적는다 — Next는 `process.env.NEXT_PUBLIC_*`를
 * 글자 그대로 쓴 곳만 빌드 때 값으로 바꿔 넣는다.
 */
const runtimeEnv = (): ReportDeps["env"] => ({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  ADMIN_ALERT_EMAIL: process.env.ADMIN_ALERT_EMAIL,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
  VERCEL_ENV: process.env.VERCEL_ENV,
});

/**
 * 오류 하나를 기록하고, 24시간 안에 처음이면 알린다.
 * 새 오류 판정은 기록 '전'에 한다 — 기록 뒤에 조회하면 동시에 난 두 건이 서로를 보고 둘 다 알림을 건너뛴다
 * (드물게 중복 발송되는 쪽을 택했다).
 */
export async function reportRequestError(
  error: unknown,
  request: ErrorRequest,
  context: Partial<ErrorContext> | undefined,
  deps: ReportDeps = { fetch: globalThis.fetch, env: runtimeEnv() },
): Promise<void> {
  try {
    const supabaseUrl = deps.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = deps.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) return;

    const err = error as { message?: string; stack?: string; digest?: string } | null;
    const raw = String(err?.message ?? error);
    // 봇이 /ko, /ko/index.php 같은 경로에 뿌리는 POST와 재배포 직후 낡은 클라이언트의 액션 호출은
    // Next가 "Failed to find Server Action"으로 거절한다. 우리 코드 결함이 아니고 30일치 오류의
    // 전부가 이것이라(2026-09 실측 9/9건) 기록·알림에서 제외해 진짜 오류가 묻히지 않게 한다.
    if (raw.startsWith("Failed to find Server Action")) return;

    const message = normalizeErrorMessage(raw, request.path).slice(0, 2000);
    const store = appErrors(deps, supabaseUrl, serviceKey);
    const isFirst = await store.isFirstIn24h(message);
    const siteUrl = deps.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";
    // 기록과 메일은 서로 기다릴 이유가 없다 — Next가 이 훅을 기다리므로 함께 보내 오류 응답이 덜 늦어지게 한다
    const [, failure] = await Promise.all([
      store.insert({
        digest: err?.digest ?? null,
        message,
        stack: err?.stack ? String(err.stack).slice(0, 8000) : null,
        path: request.path.slice(0, 500),
        method: request.method,
      }),
      isFirst
        ? sendAlert(deps, {
            message,
            method: request.method,
            path: request.path,
            logsUrl: `${siteUrl}${adminBasePath("ko")}/logs`,
            routePath: context?.routePath,
            routeType: context?.routeType,
            renderSource: context?.renderSource,
            userAgent: firstHeader(request.headers["user-agent"]),
            digest: err?.digest,
            commit: deps.env.VERCEL_GIT_COMMIT_SHA,
            deployEnv: deps.env.VERCEL_ENV,
          })
        : null,
    ]);
    // 알림이 나가지 못한 것은 조용히 묻히면 안 된다 — 메일 없이 기록만 남긴다(lib/logs.ts의 logAppError와 같은 모양).
    // 다시 보내지는 않는다: 위에서 기록한 행 때문에 같은 오류는 24시간 동안 중복으로 판정된다. 알림이 실제로
    // 나갔는지를 따로 적어 두어야(alerted_at 같은 컬럼) 다음 발생 때 다시 시도할 수 있다.
    if (failure) {
      await store.insert({
        digest: null,
        message: `error alert email failed (${failure}): ${message.replace(/\s+/g, " ").slice(0, 200)}`,
        stack: null,
        path: "instrumentation.alert",
        method: "internal",
      });
    }
  } catch {
    // 기록·알림 실패 — 무시 (원 요청에 영향 금지)
  }
}
