// 패널 공유 상태·공용 헬퍼 — 모듈 간 순환 참조 없이 함께 쓰는 것들만 모은다
import { normalizeAxeResults, type Finding } from "@a11ychk/core/catalog";
import type { IncompleteDecision } from "../incomplete";

// 빌드 시 esbuild define으로 치환됨
declare const process: { env: { A11YCHK_SITE_ORIGIN: string; A11YCHK_AXE_VERSION: string } };
export const SITE_ORIGIN = process.env.A11YCHK_SITE_ORIGIN;
export const AXE_VERSION = process.env.A11YCHK_AXE_VERSION;

export interface StoredSession {
  accessToken: string;
  expiresAt: number;
  email?: string;
}

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** 프라미스에 타임아웃을 건다. 초과하면 message로 reject. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export type PageResult = ReturnType<typeof normalizeAxeResults>;

/** 검사 결과 공유 상태 — ESM에서 모듈 간 let 재할당은 반영되지 않으므로 객체 필드로 관리 */
export const state = {
  lastPage: null as PageResult | null,
  currentTabId: null as number | null,
  /** 확인 필요(incomplete) 항목 — 노드 포함 파생 데이터 (axe 규칙만; 커스텀은 id뿐) */
  lastIncomplete: [] as Finding[],
  /** 확인 필요 항목에 대한 심사 결정 (캐시에 함께 보존) */
  incompleteDecisions: {} as Record<string, IncompleteDecision>,
  /** 검사 실행 시각 (캐시 복원 안내용) */
  lastScannedAt: 0,
};
