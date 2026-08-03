/**
 * Claude Code 플러그인 매니페스트 구조 검사 — CI용.
 *
 * `claude plugin validate`와 같은 회귀(깨진 JSON, 필수 필드 누락, 스킬 파일 소실,
 * marketplace가 가리키는 경로 부재)를 러너에 claude CLI 없이 잡는다. 로컬에서는
 * `claude plugin validate .`과 `claude plugin validate ./plugins/a11ychk`를 함께 쓸 것.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(root, path), "utf8"));
  } catch (e) {
    errors.push(`${path}: JSON 파싱 실패 — ${e.message}`);
    return null;
  }
}

const marketplace = readJson(".claude-plugin/marketplace.json");
if (marketplace) {
  if (!marketplace.name) errors.push("marketplace.json: name 누락");
  if (!marketplace.owner?.name) errors.push("marketplace.json: owner.name 누락");
  for (const p of marketplace.plugins ?? []) {
    if (typeof p.source === "string" && !existsSync(join(root, p.source))) {
      errors.push(`marketplace.json: source 경로 없음 — ${p.source}`);
    }
  }
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    errors.push("marketplace.json: plugins 비어 있음");
  }
}

const plugin = readJson("plugins/a11ychk/.claude-plugin/plugin.json");
if (plugin && !plugin.name) errors.push("plugin.json: name 누락");

const mcp = readJson("plugins/a11ychk/.mcp.json");
if (mcp && !mcp.mcpServers?.a11ychk?.command) errors.push(".mcp.json: mcpServers.a11ychk.command 누락");

for (const skill of ["a11y-audit", "kwcag-audit"]) {
  const path = `plugins/a11ychk/skills/${skill}/SKILL.md`;
  if (!existsSync(join(root, path))) {
    errors.push(`스킬 파일 없음 — ${path}`);
    continue;
  }
  const text = readFileSync(join(root, path), "utf8");
  if (!/^---\n[\s\S]*?\bdescription:/m.test(text)) errors.push(`${path}: frontmatter description 누락`);
}

if (errors.length > 0) {
  console.error(`플러그인 구조 검사 실패 ${errors.length}건:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("플러그인 구조 검사 통과");
