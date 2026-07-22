/**
 * 검사 결과 세션 캐시 — 탭 전환·패널 재열기로 결과가 소실되지 않도록
 * chrome.storage.session(브라우저 종료 시 자동 삭제)에 URL별 최근 결과를 보존한다.
 * 페이지가 그새 바뀌었을 수 있으므로 복원 시 "이전 결과" 안내와 함께 표시한다.
 */
import type { Finding, PageScanResult } from "@a11ychk/core/catalog";

export interface CachedScan {
  page: PageScanResult;
  /** 노드 포함 확인 필요(incomplete) 항목 — 심사 흐름용 파생 데이터 */
  incomplete: Finding[];
  /** 확인 필요 항목에 대한 심사 결정 (위반 확정/문제없음) */
  decisions: Record<string, "failed" | "passed">;
  /** epoch ms — 복원 안내·LRU 정리 기준 */
  scannedAt: number;
}

const PREFIX = "scan:";
const MAX_ENTRIES = 8;

/**
 * URL 정규화 — 해시·쿼리 순서 변형·기본 포트·트레일링 슬래시로 같은 페이지의
 * 키가 갈라지는 것을 방지한다. (판정 저장 키와 캐시 키가 공유)
 */
export function normalizeUrlKey(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";
    u.searchParams.sort();
    let s = u.toString();
    if (u.pathname === "/" && !u.search && s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return raw;
  }
}

export async function getCachedScan(url: string): Promise<CachedScan | null> {
  try {
    const key = PREFIX + normalizeUrlKey(url);
    const stored = await chrome.storage.session.get(key);
    return (stored[key] as CachedScan | undefined) ?? null;
  } catch {
    return null; // storage.session 미지원·실패 — 캐시 없이 동작
  }
}

export async function setCachedScan(url: string, data: CachedScan): Promise<void> {
  try {
    await chrome.storage.session.set({ [PREFIX + normalizeUrlKey(url)]: data });
    await evictOldest();
  } catch {
    // 쿼터 초과 등 — 캐시는 편의 기능이므로 실패를 무시한다
  }
}

/** LRU 정리 — 상한 초과 시 가장 오래된 항목부터 삭제 */
async function evictOldest(): Promise<void> {
  const all = await chrome.storage.session.get(null);
  const entries = Object.entries(all)
    .filter(([k]) => k.startsWith(PREFIX))
    .map(([k, v]) => ({ key: k, at: (v as CachedScan).scannedAt ?? 0 }))
    .sort((a, b) => a.at - b.at);
  const excess = entries.length - MAX_ENTRIES;
  if (excess > 0) {
    await chrome.storage.session.remove(entries.slice(0, excess).map((e) => e.key));
  }
}
