/**
 * 카탈로그 조회 도구 — 브라우저 없이 즉답한다.
 * get_fix_guide: axe/자체 규칙 하나의 한국어 개선 가이드와 이중 매핑
 * kwcag_checkpoint: KWCAG 2.2 검사항목 하나의 검사 방법과 자동 판정 규칙(역매핑)
 */
import {
  KWCAG_PRINCIPLE_LABEL,
  RULE_BY_ID,
  RULE_CATALOG,
  WCAG_BY_ID,
  getRuleEntry,
  kwcagItemsOf,
  kwcagLabel,
  kwcagNoListLabel,
  pickLocale,
  resolveKwcagInput,
  understandingUrl,
  type KwcagInputMatch,
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
  const kwItems = kwcagItemsOf(entry.kwcag);
  const structuredContent = {
    ruleId,
    known,
    title: pickLocale(entry.title, lang),
    level: entry.level,
    wcag: entry.wcag,
    // KWCAG는 공식 번호(KS X OT0003:2022)로 내보낸다
    kwcag: kwItems.map((i) => i.ksNo),
    guide: pickLocale(entry.guide, lang),
  };
  const L = (ko: string, en: string) => (lang === "en" ? en : ko);
  const refs = [
    entry.wcag.length ? `WCAG ${entry.wcag.join(", ")}` : null,
    kwItems.length ? `KWCAG ${kwcagNoListLabel(kwItems, lang)}` : null,
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
    /** KS X OT0003:2022 검사항목 번호 */
    id: string;
    /** 웹 접근성 품질인증 심사 일련번호 1~33 */
    serial: number;
    slug: string;
    name: string;
    principle: string;
    wcag: { id: string; name: string; level: string; understandingUrl: string | null }[];
    autoCoverage: string;
    howToTest: string | null;
    automatedRules: { ruleId: string; title: string }[];
    /** 입력한 번호의 옛 a11ychk 뜻이 달랐거나 옛 번호로 찾았을 때의 안내 */
    legacyNote: string | null;
  };
  text: string;
}

/** 검사항목 입력 해석 — 슬러그, 일련번호(1~33), 공식 번호, 옛 a11ychk 번호(7.4.x) */
export function resolveKwcagItem(input: string): KwcagInputMatch | null {
  return resolveKwcagInput(input);
}

function legacyNoteOf(match: KwcagInputMatch, lang: "ko" | "en"): string | null {
  const { item, legacy } = match;
  if (!legacy) return null;
  if (legacy.item === item) {
    return lang === "en"
      ? `Note: found by the old a11ychk number (${legacy.id}) used through a11ychk MCP 0.1.6. Its KS X OT0003:2022 number is ${item.ksNo}, checkpoint ${item.serial}.`
      : `참고: a11ychk MCP 0.1.6까지 쓰던 옛 번호(${legacy.id})로 찾은 항목입니다. 공식 번호는 ${item.ksNo}, 검사항목 ${item.serial}번입니다.`;
  }
  return lang === "en"
    ? `Note: through a11ychk MCP 0.1.6, ${legacy.id} referred to "${pickLocale(legacy.item.name, "en")}" (now ${legacy.item.ksNo}, checkpoint ${legacy.item.serial}). This result is the checkpoint numbered ${legacy.id} in KS X OT0003:2022.`
    : `참고: a11ychk MCP 0.1.6까지 쓰던 옛 번호(${legacy.id})는 「${legacy.item.name.ko}」 항목을 가리켰습니다. 그 항목의 공식 번호는 ${legacy.item.ksNo}, 검사항목 ${legacy.item.serial}번입니다. 이 결과는 공식 번호 ${legacy.id}의 항목입니다.`;
}

export function runKwcagCheckpointTool(match: KwcagInputMatch, lang: "ko" | "en"): KwcagCheckpointResult {
  const { item } = match;
  const L = (ko: string, en: string) => (lang === "en" ? en : ko);
  const rules = RULE_CATALOG.filter((r) => r.kwcag.includes(item.slug));
  const structuredContent = {
    id: item.ksNo,
    serial: item.serial,
    slug: item.slug,
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
    legacyNote: legacyNoteOf(match, lang),
  };

  const coverageNote = {
    full: L("자동 검사만으로 판정할 수 있는 항목입니다.", "Automation can decide this checkpoint."),
    partial: L("자동 검사가 일부를 잡고, 나머지는 사람이 확인해야 합니다.", "Automation covers part of it; the rest needs a person."),
    none: L("자동 판정이 불가능해 사람이 직접 확인해야 합니다.", "Automation cannot decide this checkpoint."),
  }[item.autoCoverage];

  const lines = [
    `KWCAG 2.2 ${kwcagLabel(item, lang)} (${item.ksNo}) — ${structuredContent.principle}`,
    `${L("대응 WCAG", "Maps to WCAG")}: ${structuredContent.wcag.map((w) => `${w.id}(${w.level})`).join(", ") || L("없음(국내 고유 항목)", "none (Korea-specific)")}`,
    coverageNote,
  ];
  if (structuredContent.legacyNote) {
    lines.push("");
    lines.push(structuredContent.legacyNote);
  }
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
