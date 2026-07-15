/**
 * 사이트 수준 검사 (WCAG-EM Phase C) — 표본 여러 페이지의 시그니처를 비교해
 * 단일 페이지 도구가 못 하는 성공기준을 판정한다. 순수 함수.
 */
import type { FindingNode, PageSignature, SiteCheckOutcome } from "../types";

function node(html: string, summary: string): FindingNode {
  return { selector: "site", html, failureSummary: summary };
}

/** 두 링크 시퀀스의 공통 항목이 같은 상대 순서인지 (일관된 내비게이션) */
function orderConsistent(a: string[], b: string[]): boolean {
  const setB = new Set(b);
  const common = a.filter((x) => setB.has(x));
  const setA = new Set(a);
  const commonB = b.filter((x) => setA.has(x));
  if (common.length < 2) return true; // 비교할 공통 항목이 적으면 판단 보류(일관으로 간주)
  return common.join("␟") === commonB.join("␟");
}

export function computeSiteChecks(signatures: PageSignature[]): SiteCheckOutcome[] {
  const out: SiteCheckOutcome[] = [];
  if (signatures.length < 2) return out; // 사이트 수준 검사는 표본 2페이지 이상일 때만

  // ── 2.4.2 제목 유일성 ──
  const titles = signatures.map((s) => s.title).filter(Boolean);
  const uniqueTitles = new Set(titles);
  if (titles.length >= 2 && uniqueTitles.size === 1) {
    out.push({
      ruleId: "a11ychk:page-title-unique",
      outcome: "failed",
      count: titles.length,
      nodes: [node(`<title>${titles[0]}</title>`, `표본 ${titles.length}개 페이지의 제목이 모두 "${titles[0]}"로 동일합니다.`)],
    });
  }

  // ── 3.2.3 일관된 내비게이션 ──
  const withNav = signatures.filter((s) => s.navLinks.length >= 2);
  if (withNav.length >= 2) {
    let inconsistent = false;
    for (let i = 1; i < withNav.length; i++) {
      if (!orderConsistent(withNav[0]!.navLinks, withNav[i]!.navLinks)) {
        inconsistent = true;
        break;
      }
    }
    out.push(
      inconsistent
        ? {
            ruleId: "a11ychk:consistent-navigation",
            outcome: "review",
            count: withNav.length,
            nodes: [node("<nav>", "페이지마다 주 내비게이션의 링크 순서가 다릅니다. 의도된 것인지 직접 확인하세요.")],
          }
        : { ruleId: "a11ychk:consistent-navigation", outcome: "passed", count: 0, nodes: [] },
    );
  }

  // ── 2.4.5 여러 방법 (내비게이션 외 검색/사이트맵 존재) ──
  const hasSearch = signatures.some((s) => s.hasSearch);
  const hasSitemap = signatures.some((s) => s.hasSitemap);
  const hasNav = signatures.some((s) => s.navLinks.length >= 2);
  if (hasNav && (hasSearch || hasSitemap)) {
    out.push({ ruleId: "a11ychk:multiple-ways", outcome: "passed", count: 0, nodes: [] });
  } else if (hasNav) {
    out.push({
      ruleId: "a11ychk:multiple-ways",
      outcome: "failed",
      count: signatures.length,
      nodes: [node("<body>", "내비게이션 외에 검색 기능이나 사이트맵을 찾지 못했습니다. 페이지를 찾는 방법을 2가지 이상 제공하세요.")],
    });
  }

  return out;
}
