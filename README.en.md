<div align="center">

# A11y Check

**Korean-first web accessibility auditing engine, dual-mapped to WCAG 2.2 + KWCAG 2.2**

Give it one URL — it collects representative pages, audits them, and generates a
structured report with **Korean-language remediation guides** and ready-to-use
fix-request documents for AI coding tools.

[![CI](https://github.com/IsaacEryn/a11ychk/actions/workflows/ci.yml/badge.svg)](https://github.com/IsaacEryn/a11ychk/actions/workflows/ci.yml)
[![core: Apache-2.0](https://img.shields.io/badge/core-Apache--2.0-1a7f6e.svg)](packages/core/LICENSE)
[![app: AGPL-3.0](https://img.shields.io/badge/app-AGPL--3.0-1a7f6e.svg)](apps/web/LICENSE)

**[🔗 Live: a11ychk.com](https://www.a11ychk.com)** ·
[Public directory](https://www.a11ychk.com/en/directory) ·
[Impact metrics](https://www.a11ychk.com/en/impact) ·
**[한국어 README](README.md)**

</div>

---

## Why A11y Check

Most automated checkers stop at listing violations in English. A11y Check turns
diagnosis into **artifacts that drive remediation**:

- 🇰🇷 **KWCAG 2.2 rule catalog** — 106 rules in [`packages/core/src/catalog`](packages/core/src/catalog),
  each dual-mapped to WCAG 2.2 success criteria **and** all 33 checkpoints of KWCAG 2.2
  (Korea's national accessibility guideline), with Korean remediation guidance per rule.
- 🔧 **Diagnosis → fix** — every finding ships with a remediation guide plus an
  auto-generated **fix-request document (Markdown/JSON)** you can paste straight into
  AI coding tools (Cursor, Copilot, Claude, …).
- 🧭 **WCAG-EM methodology** — structured sampling → automated audit → expert judgment
  → combined conformance score, exportable as an EARL report.
- 🙅 **Honest automation** — checks the tool cannot decide are surfaced with manual
  test instructions instead of being hidden. A 2-pass stability filter suppresses
  render-transient false positives (fade-in animations, webfont timing).

## What's inside

| Package | License | Description |
|---|---|---|
| [`packages/core`](packages/core) | Apache-2.0 | Scanner engine, crawler, rule catalog, SSRF guard — embeddable |
| [`apps/web`](apps/web) | AGPL-3.0 | Next.js service: reports, scheduled scans, badges, public directory |
| [`apps/extension`](apps/extension) | Apache-2.0 | Chrome MV3 side-panel: audit pages behind login, visual tools, expert judgment |

## Quick start

```bash
npm install
npm run dev          # web app on :3000 (needs Supabase env — see docs/SETUP.md)
npm run test         # unit tests
npm run build        # production build
```

See [docs/SETUP.md](docs/SETUP.md) for Supabase/Vercel configuration and
[docs/architecture.md](docs/architecture.md) for pipeline & security design.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
Rule suggestions for the KWCAG catalog are especially appreciated.
