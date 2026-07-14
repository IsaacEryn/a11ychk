/**
 * robots.txt 존중 — 도메인 소유 확인 없이 공개 페이지를 수집하는 서비스이므로
 * 크롤링 전 반드시 허용 여부를 확인한다.
 */
import { guardedFetch } from "./urlGuard";

export interface RobotsRules {
  /** 그룹별 (Disallow/Allow) 규칙. 우리 UA에 가장 구체적으로 매칭된 그룹만 보관 */
  disallow: string[];
  allow: string[];
}

const OUR_AGENT = "a11ychk-bot";

/** robots.txt 본문을 파싱해 우리 UA에 적용되는 규칙을 추출 */
export function parseRobots(body: string): RobotsRules {
  const groups: { agents: string[]; disallow: string[]; allow: string[] }[] = [];
  let current: { agents: string[]; disallow: string[]; allow: string[] } | null = null;
  let lastWasAgent = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!current) continue;
      if (field === "disallow" && value) current.disallow.push(value);
      if (field === "allow" && value) current.allow.push(value);
    }
  }

  // 우리 UA 전용 그룹 > 와일드카드 그룹
  const specific = groups.find((g) => g.agents.some((a) => OUR_AGENT.includes(a) || a.includes(OUR_AGENT)));
  const wildcard = groups.find((g) => g.agents.includes("*"));
  const chosen = specific ?? wildcard;
  return { disallow: chosen?.disallow ?? [], allow: chosen?.allow ?? [] };
}

function matchLength(pattern: string, path: string): number {
  // robots 패턴: * 와일드카드, $ 앵커 지원
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = new RegExp(
    "^" + body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""),
  );
  return regex.test(path) ? pattern.length : -1;
}

/** 해당 경로가 크롤링 허용인지 판정 (가장 긴 매칭 규칙 우선, 동률이면 Allow 우선) */
export function isPathAllowed(rules: RobotsRules, path: string): boolean {
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const p of rules.allow) bestAllow = Math.max(bestAllow, matchLength(p, path));
  for (const p of rules.disallow) bestDisallow = Math.max(bestDisallow, matchLength(p, path));
  return bestAllow >= bestDisallow;
}

/** origin의 robots.txt를 가져와 규칙 반환. 없거나 실패하면 전체 허용으로 간주 */
export async function fetchRobots(origin: string): Promise<RobotsRules> {
  try {
    const res = await guardedFetch(new URL("/robots.txt", origin).toString());
    if (!res.ok) return { disallow: [], allow: [] };
    const text = await res.text();
    return parseRobots(text.slice(0, 500_000));
  } catch {
    return { disallow: [], allow: [] };
  }
}
