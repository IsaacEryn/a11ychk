/**
 * 카탈로그 조회 도구 — 브라우저 없이 즉답한다.
 * get_fix_guide: axe/자체 규칙 하나의 한국어 개선 가이드와 이중 매핑
 * kwcag_checkpoint: KWCAG 2.2 검사항목 하나의 검사 방법과 자동 판정 규칙(역매핑)
 */
import {
  KWCAG_BY_ID,
  KWCAG_BY_SLUG,
  KWCAG_PRINCIPLE_LABEL,
  RULE_BY_ID,
  RULE_CATALOG,
  WCAG_BY_ID,
  getRuleEntry,
  kwcagSlug,
  pickLocale,
  understandingUrl,
  type KwcagItem,
} from "@a11ychk/core";
import { footer } from "./funnel";

export interface FixGuideResult {
  structuredContent: {
    ruleId: string;
    known: boolean;
    title: string;
    level: string;
    wcag: string[];
    kwcag: string[];
    guide: string;
  };
  text: string;
}

export function runFixGuideTool(ruleId: string, lang: "ko" | "en"): FixGuideResult {
  const known = RULE_BY_ID.has(ruleId);
  const entry = getRuleEntry(ruleId);
  const structuredContent = {
    ruleId,
    known,
    title: pickLocale(entry.title, lang),
    level: entry.level,
    wcag: entry.wcag,
    kwcag: entry.kwcag,
    guide: pickLocale(entry.guide, lang),
  };
  const L = (ko: string, en: string) => (lang === "en" ? en : ko);
  const refs = [
    entry.wcag.length ? `WCAG ${entry.wcag.join(", ")}` : null,
    entry.kwcag.length ? `KWCAG ${entry.kwcag.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const lines = [
    `${structuredContent.title} (\`${ruleId}\`${refs ? `, ${refs}` : ""})`,
    "",
    structuredContent.guide,
  ];
  if (!known) {
    lines.push("");
    lines.push(L("카탈로그에 등재되지 않은 규칙이라 일반 안내만 제공합니다.", "This rule is not in the catalog; only generic guidance is available."));
  }
  return { structuredContent, text: lines.join("\n") };
}

export interface KwcagCheckpointResult {
  structuredContent: {
    id: string;
    slug: string;
    name: string;
    principle: string;
    wcag: { id: string; name: string; level: string; understandingUrl: string | null }[];
    autoCoverage: string;
    howToTest: string | null;
    automatedRules: { ruleId: string; title: string }[];
  };
  text: string;
}

export function resolveKwcagItem(idOrSlug: string): KwcagItem | null {
  return KWCAG_BY_ID.get(idOrSlug) ?? KWCAG_BY_SLUG.get(idOrSlug) ?? null;
}

export function runKwcagCheckpointTool(item: KwcagItem, lang: "ko" | "en"): KwcagCheckpointResult {
  const L = (ko: string, en: string) => (lang === "en" ? en : ko);
  const rules = RULE_CATALOG.filter((r) => r.kwcag.includes(item.id));
  const structuredContent = {
    id: item.id,
    slug: kwcagSlug(item),
    name: pickLocale(item.name, lang),
    principle: KWCAG_PRINCIPLE_LABEL[item.principle][lang === "en" ? "en" : "ko"],
    wcag: item.wcag.map((scId) => {
      const c = WCAG_BY_ID.get(scId);
      return {
        id: scId,
        name: c ? pickLocale(c.name, lang) : scId,
        level: c?.level ?? "?",
        understandingUrl: understandingUrl(scId) ?? null,
      };
    }),
    autoCoverage: item.autoCoverage,
    howToTest: item.howToTest ? pickLocale(item.howToTest, lang) : null,
    automatedRules: rules.map((r) => ({ ruleId: r.ruleId, title: pickLocale(r.title, lang) })),
  };

  const coverageNote = {
    full: L("자동 검사만으로 판정할 수 있는 항목입니다.", "Automation can decide this checkpoint."),
    partial: L("자동 검사가 일부를 잡고, 나머지는 사람이 확인해야 합니다.", "Automation covers part of it; the rest needs a person."),
    none: L("자동 판정이 불가능해 사람이 직접 확인해야 합니다.", "Automation cannot decide this checkpoint."),
  }[item.autoCoverage];

  const lines = [
    `KWCAG ${item.id} ${structuredContent.name} — ${structuredContent.principle}`,
    `${L("대응 WCAG", "Maps to WCAG")}: ${structuredContent.wcag.map((w) => `${w.id}(${w.level})`).join(", ") || L("없음(국내 고유 항목)", "none (Korea-specific)")}`,
    coverageNote,
  ];
  if (structuredContent.howToTest) {
    lines.push("");
    lines.push(`${L("검사 방법", "How to test")}: ${structuredContent.howToTest}`);
  }
  if (rules.length > 0) {
    lines.push("");
    lines.push(
      `${L("자동 판정 규칙", "Automated rules")}: ${rules.map((r) => r.ruleId).join(", ")} — ${L("상세는 get_fix_guide로 조회", "use get_fix_guide for details")}`,
    );
  }
  lines.push("");
  lines.push(footer(lang, "catalog"));
  return { structuredContent, text: lines.join("\n") };
}
