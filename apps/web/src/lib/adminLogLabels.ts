/**
 * 관리자 로그 화면의 분류 상수·순수 함수.
 *
 * t()에 의존하지 않고 i18n 키 접미만 돌려준다 — 페이지에서
 * `t(\`logs.errorKind.${errorKindKey(msg)}\`)`처럼 조합한다.
 */

/**
 * 감사 행위 코드 — 필터 옵션과 라벨 판정의 단일 출처.
 * logAdminAction 호출부에 새 행위를 추가하면 여기와 i18n(admin.logs.actions.*,
 * 점은 언더스코어로)도 함께 추가할 것.
 */
export const AUDIT_ACTIONS = [
  "user.block",
  "user.unblock",
  "user.set_limits",
  "user.reset_quota",
  "user.email",
  "plans.toggle",
  "plans.bulk_set",
  "pages.bulk_set",
  "inquiry.reply",
  "auth.login",
  "stats.refresh",
  "referral.approve",
  "referral.reject",
  "referral.promote",
  "referral.clearEarned",
  "scan.admin_retry",
  "report.view",
  "announcement.publish",
  "announcement.clear",
] as const;

/** 오류 메시지 → 분류 키 (code|timeout|network|db|generic) */
export function errorKindKey(message: string): string {
  if (/is not defined|is not a function|Cannot read|undefined is not|ReferenceError|TypeError/i.test(message))
    return "code";
  if (/timeout|timed out/i.test(message)) return "timeout";
  if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|network|socket hang up/i.test(message)) return "network";
  if (/postgres|supabase|PGRST|relation .+ does not exist|duplicate key|violates/i.test(message)) return "db";
  return "generic";
}

/** 오류 경로 → 페이지/API 분류 키 */
export function pathKindKey(path: string | null): string {
  if (!path) return "other";
  const p = path.replace(/^\/(ko|en)(?=\/|$)/, "");
  if (p === "" || p === "/") return "landing";
  if (/^\/scans\/[^/]+\/report/.test(p)) return "report";
  if (/^\/scans\/[^/]+/.test(p)) return "scanDetail";
  if (p.startsWith("/scan")) return "scanForm";
  if (p.startsWith("/dashboard")) return "dashboard";
  if (p.startsWith("/admin")) return "admin";
  if (/^\/api\/scans\/[^/]+\/pdf/.test(p)) return "apiPdf";
  if (/^\/api\/scans\/[^/]+\/csv/.test(p)) return "apiCsv";
  if (/^\/api\/scans\/[^/]+\/earl/.test(p)) return "apiEarl";
  if (/^\/api\/scans\/[^/]+\/ai-fix/.test(p)) return "apiAiFix";
  if (p.startsWith("/api/scans")) return "apiScanCreate";
  if (p.startsWith("/api/ext")) return "apiExt";
  if (p.startsWith("/api/cron")) return "apiCron";
  if (p.startsWith("/api/badge")) return "apiBadge";
  return "other";
}
