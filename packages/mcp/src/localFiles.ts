/**
 * 로컬 HTML 파일·폴더 진단 지원 (scan_dir, scan_page의 file:// 공식화).
 *
 * 배포 전 정적 산출물(빌드 결과물·정적 사이트·오프라인 웹 문서)을 서버 없이
 * 진단하기 위한 기능이다. 이 수집 로직은 의도적으로 core가 아닌 MCP 패키지에
 * 둔다 — 웹 서비스는 사용자 입력 URL을 fetch하는 모든 경로에 SSRF 가드를 두는데,
 * 로컬 파일 접근 코드가 core에 있으면 웹이 실수로 재사용할 표면이 생긴다.
 * MCP는 사용자 본인 머신에서 본인 권한으로 도는 로컬 도구라 파일 접근이 정당하다.
 */
import { statSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

/** 재귀 순회 상한 — 실수로 홈 디렉터리 같은 거대 트리를 받아도 폭주하지 않게 */
const MAX_DIR_ENTRIES = 2_000;

/** 진단 대상이 아닌 디렉터리 — 의존성·빌드 캐시·숨김 폴더 */
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".cache", "coverage"]);

const HTML_EXT = /\.x?html?$/i;

export class LocalPathError extends Error {}

/**
 * 디렉터리에서 HTML 파일을 재귀 수집해 file:// URL 목록으로 반환한다.
 * - 닷파일·SKIP_DIRS 제외, 심링크 미추적(순환·탈출 방지)
 * - 경로 정렬로 결정적 순서 보장
 * @throws LocalPathError 경로가 없거나 디렉터리가 아니거나 HTML이 0개일 때
 */
export function collectHtmlFiles(dir: string, maxFiles: number): string[] {
  const root = path.resolve(dir);
  let rootStat;
  try {
    rootStat = statSync(root);
  } catch {
    throw new LocalPathError(`경로가 존재하지 않습니다: ${root}`);
  }
  if (!rootStat.isDirectory()) {
    throw new LocalPathError(`디렉터리가 아닙니다: ${root} — 파일 하나는 scan_page에 file:// URL로 넘기세요.`);
  }

  const found: string[] = [];
  let visited = 0;
  const walk = (current: string): void => {
    if (found.length >= maxFiles || visited >= MAX_DIR_ENTRIES) return;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return; // 권한 없는 하위 디렉터리는 건너뛴다
    }
    // 결정적 순서: 파일 먼저(이름순), 그다음 하위 디렉터리(이름순)
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (found.length >= maxFiles || ++visited >= MAX_DIR_ENTRIES) return;
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile() && HTML_EXT.test(entry.name)) found.push(full);
    }
    for (const entry of entries) {
      if (found.length >= maxFiles || visited >= MAX_DIR_ENTRIES) return;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name) || entry.isSymbolicLink() || !entry.isDirectory())
        continue;
      walk(path.join(current, entry.name));
    }
  };
  walk(root);

  if (found.length === 0) {
    throw new LocalPathError(
      `HTML 파일을 찾지 못했습니다: ${root} (닷파일·node_modules 등은 제외하고 .html/.htm을 찾습니다)`,
    );
  }
  return found.map((f) => pathToFileURL(f).href);
}

/**
 * scan_page에 들어온 file:// URL 검증 — 존재하는 일반 파일이어야 한다.
 * 디렉터리를 열면 크로미엄이 디렉터리 목록 페이지를 렌더링해 유령 위반이 나온다.
 * @returns 문제가 있으면 사용자에게 보여줄 한국어 메시지, 정상이면 null
 */
export function validateFileUrl(url: string): string | null {
  let filePath: string;
  try {
    filePath = fileURLToPath(url);
  } catch {
    return `file:// URL을 경로로 해석하지 못했습니다: ${url}`;
  }
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return `파일이 존재하지 않습니다: ${filePath}`;
  }
  if (stat.isDirectory()) {
    return `디렉터리입니다: ${filePath} — 폴더 일괄 진단은 scan_dir 도구를 사용하세요.`;
  }
  return null;
}
