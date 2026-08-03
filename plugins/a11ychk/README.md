# A11y Check — Claude Code 플러그인 / Claude Code Plugin

웹 접근성 감사 스킬 + 검사 엔진(MCP 서버)을 한 번에 설치합니다.
Web accessibility audit skills bundled with the `@a11ychk/mcp` scanner — installed together.

## 설치 / Install

```
/plugin marketplace add IsaacEryn/a11ychk
/plugin install a11ychk@a11ychk
```

설치하면 스킬 2개와 MCP 서버(`@a11ychk/mcp`, npx로 자동 실행)가 함께 등록됩니다.
Installing registers two skills and the MCP scanner (auto-run via npx).

## 스킬 / Skills

| 스킬 | 하는 일 |
|---|---|
| `/a11ychk:a11y-audit` | 검사 → `guide`(한국어 수정 지침)로 코드 수정 → 재검사 루프. localhost 개발 서버의 배포 전 점검에 적합 / Scan → fix with per-violation guides → re-scan. Best for pre-deploy localhost checks |
| `/a11ychk:kwcag-audit` | KWCAG 2.2 33개 검사항목 관점 점검 — 자동 판정·수동 확인 구분 매트릭스 / KWCAG 33-checkpoint audit matrix |

검사 판정은 [a11ychk.com](https://www.a11ychk.com) 웹 보고서·GitHub Action과 동일합니다
(WCAG 2.2 AA + KWCAG 2.2 이중 매핑, 모범 사례 권고 분리).

첫 검사는 chromium이 필요합니다 — 없으면 설치된 Chrome으로 폴백하고, 그것도 없으면
설치 명령을 안내합니다. Scanning needs chromium (falls back to installed Chrome).

## 라이선스 / License

Apache-2.0 · [IsaacEryn/a11ychk](https://github.com/IsaacEryn/a11ychk)
