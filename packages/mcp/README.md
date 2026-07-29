# @a11ychk/mcp

Web accessibility scanning for AI coding tools, over MCP — **WCAG 2.2 AA + KWCAG 2.2**
(Korea's national accessibility guidelines) with **Korean remediation guides** for every finding.

AI 코딩 도구(Claude Code·Cursor 등)에서 개발 중인 페이지를 그 자리에서 접근성 검사하고,
위반마다 한국어 개선 가이드를 받아 바로 수정하는 MCP 서버입니다. localhost 개발 서버
검사에 적합합니다.

## Setup

Claude Code:

```bash
claude mcp add a11ychk -- npx -y @a11ychk/mcp
```

Or in any MCP client config (`.mcp.json`, Cursor, etc.):

```json
{
  "mcpServers": {
    "a11ychk": { "command": "npx", "args": ["-y", "@a11ychk/mcp"] }
  }
}
```

Scanning needs chromium (one-time; catalog tools work without it):

```bash
npx playwright install chromium
```

## Tools

| Tool | What it does | Browser |
|---|---|---|
| `scan_page` | Audit one page — compliance rate, violations with Korean fix guides | required |
| `scan_pages` | Audit up to 10 pages at once | required |
| `crawl_sample` | Collect a representative page sample (sitemap/links, robots-aware) | no |
| `get_fix_guide` | Remediation guide + WCAG/KWCAG mapping for a rule | no |
| `kwcag_checkpoint` | One of KWCAG 2.2's 33 checkpoints: how to test, mapped rules | no |

Findings that map to no WCAG success criterion (axe best-practice rules) are reported as
advisories and excluded from the compliance rate — the same judgment used by the
[a11ychk.com](https://www.a11ychk.com) reports and the
[GitHub Action](https://github.com/marketplace/actions/a11y-check).

## Why KWCAG?

If you ship a product used in South Korea, KWCAG 2.2 is what local accessibility reviews
and certification are assessed against — and it does not line up with WCAG one-to-one.
Every finding here is dual-mapped so one scan serves both standards.

## Beyond this server

Site-wide sampled scans, the manual review workflow, certification-ready reports (PDF/EARL),
and scheduled monitoring live at **[a11ychk.com](https://www.a11ychk.com)** — free to start.

Apache-2.0 · [Source](https://github.com/IsaacEryn/a11ychk/tree/main/packages/mcp) ·
[Docs](https://github.com/IsaacEryn/a11ychk/blob/main/docs/mcp.md)
