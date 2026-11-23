# @a11ychk/mcp

Web accessibility scanning for AI coding tools, over MCP — **WCAG 2.2 AA + KWCAG 2.2**
(Korea's national accessibility guidelines) with **Korean remediation guides** for every finding.

AI 코딩 도구(Claude Code·Cursor 등)에서 개발 중인 페이지를 그 자리에서 접근성 검사하고,
위반마다 한국어 개선 가이드를 받아 바로 수정하는 MCP 서버입니다. localhost 개발 서버
검사에 적합합니다. Node.js 22.19 이상이 필요합니다.

## Setup

Requirements:

- **Node.js 22.19 or later.** Check with `node --version`. The server does not start on anything
  older (see [Troubleshooting](#troubleshooting)).
- **chromium** for the scan tools, installed once with `npx playwright install chromium`.

Claude Code:

```bash
claude mcp add a11ychk -- npx -y @a11ychk/mcp
```

GitHub Copilot in VS Code: add the server to your Copilot user configuration,
`~/.copilot/mcp-config.json` (or `$COPILOT_HOME/mcp-config.json` if that variable is set):

```json
{
  "mcpServers": {
    "a11ychk": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@a11ychk/mcp"],
      "tools": ["*"]
    }
  }
}
```

You can also add it from the editor: select the Copilot harness in a chat session, run
**Chat: Open Customizations**, open **MCP Servers** → **Add Server**, choose **Command (stdio)**,
enter `npx -y @a11ychk/mcp`, and save it to **Global > Copilot Global**. To share the server with
a team, put the same `mcpServers` entry in `.mcp.json` at the workspace root. Don't use
`.vscode/mcp.json` for a new setup; VS Code has deprecated that format. VS Code may ask you to
approve a tool call before it runs. Details are in the
[VS Code MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

Or in any other MCP client config (`.mcp.json`, Cursor, etc.). If GitHub Copilot also reads that
`.mcp.json`, use the entry above with `type` and `tools`:

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

### Troubleshooting

If the server fails to start, check `node --version` in the folder where your AI coding tool runs
(version managers such as asdf or nvm can select a different Node.js per project). On Node.js
older than 22.19 the server prints `@a11ychk/mcp requires Node.js 22.19 or later` and exits, and
the client may only report a failed connection. Upgrade Node.js to 22.19 or later and run it again.

Releases up to 0.2.5 did not print that message. On older Node.js, `npx` installed the old 0.1.2
instead of the latest release, and the server exited with
`TypeError: Cannot read properties of undefined (reading 'bind')` from
`undici/lib/interceptor/decompress.js`. The fix is the same: upgrade Node.js.

## Tools

| Tool | What it does | Browser |
|---|---|---|
| `scan_page` | Audit one page — compliance rate, violations with Korean fix guides | required |
| `scan_pages` | Audit up to 10 pages at once | required |
| `scan_dir` | Audit static HTML files in a local folder, collected recursively (up to 10) | required |
| `crawl_sample` | Collect a representative page sample (sitemap/links, robots-aware) | no |
| `get_fix_guide` | Remediation guide + WCAG/KWCAG mapping for a rule | no |
| `kwcag_checkpoint` | One of KWCAG 2.2's 33 checkpoints: how to test, mapped rules | no |

Findings that map to no WCAG success criterion (axe best-practice rules) are reported as
advisories and excluded from the compliance rate — the same judgment used by the
[a11ychk.com](https://www.a11ychk.com) reports and the
[GitHub Action](https://github.com/marketplace/actions/a11y-check). Likewise, pages with no
audio or video count WCAG 1.2.x as not applicable, and multi-page scans add site-level checks
(duplicate titles, multiple ways, consistent navigation) to the rate; failed ones are listed in
`siteCheckFailures`.

## Why KWCAG?

If you ship a product used in South Korea, KWCAG 2.2 is what local accessibility reviews
and certification are assessed against — and it does not line up with WCAG one-to-one.
Every finding here is dual-mapped so one scan serves both standards.

## Beyond this server

Site-wide sampled scans, the manual review workflow, certification-ready reports (PDF/EARL),
and scheduled monitoring live at **[a11ychk.com](https://www.a11ychk.com)** — free to start.

Apache-2.0 · [Source](https://github.com/IsaacEryn/a11ychk/tree/main/packages/mcp) ·
[Docs](https://github.com/IsaacEryn/a11ychk/blob/main/docs/mcp.md)
