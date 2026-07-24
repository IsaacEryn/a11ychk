import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 관리자 로그인 이상 징후 판정.
 *
 * 로그인마다 알림을 보내면 곧 무시하게 되어 정작 위험할 때 놓친다. 익숙한 환경의
 * 로그인은 조용히 기록만 하고, 아래 신호가 있을 때만 메일을 보낸다.
 *  - newIp: 최근 이력에 없던 IP
 *  - newDevice: 최근 이력에 없던 브라우저·OS 조합
 *  - recentFailures: 최근 창에서 2단계 인증 실패가 임계 이상 (비밀번호는 뚫린 상태)
 */
export type LoginRiskReason = "newIp" | "newDevice" | "recentFailures";

/** 익숙함 판단에 쓰는 성공 이력 기간 */
const HISTORY_DAYS = 90;
/** 이번 로그인 흐름(비밀번호→MFA)이 이력으로 잡히지 않게 제외할 최근 구간 */
const CURRENT_FLOW_MS = 10 * 60_000;
/** 실패 누적을 세는 창 */
export const FAILURE_WINDOW_MS = 60 * 60_000;
/** 이 횟수에 도달하면 경보 (도달 시 1회만 — 이후 반복 발송 방지) */
export const FAILURE_THRESHOLD = 2;

/**
 * 기기 지문 — 브라우저 버전이 올라갈 때마다 "새 기기"로 오탐하지 않도록
 * 브라우저 계열과 OS만 남긴다. (순수 함수)
 * 판별 순서 주의: Edge·Chrome UA에도 Safari 토큰이 들어 있다.
 */
export function deviceFingerprint(ua: string | null | undefined): string {
  if (!ua) return "unknown";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Other";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Android/.test(ua)
          ? "Android"
          : /Linux/.test(ua)
            ? "Linux"
            : "Other";
  return `${browser}/${os}`;
}

/**
 * 이상 징후 목록 (순수 함수 — 유닛 테스트 대상).
 * 이력이 아예 없으면(첫 로그인·마이그레이션 직후) 새 IP·기기로 보지 않는다 —
 * 판단 근거가 없는 상태에서 경보를 울리면 첫 알림이 늑대 소년이 된다.
 */
export function assessLoginRisk(input: {
  ip: string | null;
  device: string;
  knownIps: string[];
  knownDevices: string[];
  recentFailures: number;
}): LoginRiskReason[] {
  const reasons: LoginRiskReason[] = [];
  const hasHistory = input.knownIps.length > 0 || input.knownDevices.length > 0;
  if (hasHistory && input.ip && !input.knownIps.includes(input.ip)) reasons.push("newIp");
  if (hasHistory && !input.knownDevices.includes(input.device)) reasons.push("newDevice");
  if (input.recentFailures >= FAILURE_THRESHOLD) reasons.push("recentFailures");
  return reasons;
}

export interface LoginHistory {
  knownIps: string[];
  knownDevices: string[];
  recentFailures: number;
}

/**
 * 판정에 필요한 이력 수집 — 최근 성공 로그인의 IP·기기와 최근 실패 수.
 * 이번 로그인 흐름에서 방금 남긴 기록(비밀번호 단계)은 CURRENT_FLOW_MS로 제외해야
 * 현재 IP가 늘 "익숙한 IP"로 잡히는 자기 참조를 피할 수 있다.
 * 조회 실패(0031 미적용 등)는 빈 이력으로 관용 — 알림을 못 보내느니 조용히 넘긴다.
 */
export async function collectLoginHistory(admin: SupabaseClient, userId: string): Promise<LoginHistory> {
  const now = Date.now();
  const since = new Date(now - HISTORY_DAYS * 24 * 3600_000).toISOString();
  const before = new Date(now - CURRENT_FLOW_MS).toISOString();

  const { data: past } = await admin
    .from("login_logs")
    .select("ip, user_agent")
    .eq("user_id", userId)
    .eq("outcome", "success")
    .gte("created_at", since)
    .lt("created_at", before)
    .limit(500)
    .then(
      (r) => r,
      () => ({ data: null }),
    );

  const knownIps = new Set<string>();
  const knownDevices = new Set<string>();
  for (const row of (past ?? []) as { ip: string | null; user_agent: string | null }[]) {
    if (row.ip) knownIps.add(row.ip);
    knownDevices.add(deviceFingerprint(row.user_agent));
  }

  const { count } = await admin
    .from("login_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("outcome", "mfa_failed")
    .gte("created_at", new Date(now - FAILURE_WINDOW_MS).toISOString())
    .then(
      (r) => r,
      () => ({ count: 0 }),
    );

  return { knownIps: [...knownIps], knownDevices: [...knownDevices], recentFailures: count ?? 0 };
}
