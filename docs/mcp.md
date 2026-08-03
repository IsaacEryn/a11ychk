# AI 코딩 도구에서 접근성 검사 (MCP 서버)

A11y Check의 검사 엔진을 Claude Code·Cursor 같은 AI 코딩 도구가 직접 호출할 수 있는
MCP 서버(`@a11ychk/mcp`)입니다. 웹 서비스·GitHub Action과 같은 엔진(axe-core + 자체
규칙)으로 검사하고, 모든 위반을 WCAG 2.2 성공기준과 KWCAG 2.2 검사항목에 함께
매핑하며, 위반마다 한국어 개선 가이드를 돌려줍니다.

가장 큰 쓸모는 **배포 전 검사**입니다. 웹 서비스는 공개 URL만 검사할 수 있고 GitHub
Action은 커밋 이후지만, MCP 서버는 사용자 머신에서 돌기 때문에 아직 커밋도 안 한
localhost 개발 서버를 검사할 수 있습니다 — AI가 검사하고, 가이드를 읽고, 코드를
고치고, 재검사하는 루프가 대화 안에서 돕니다.

## 설치

Claude Code — **플러그인**으로 설치하면 MCP 서버와 감사 스킬 2종이 함께 등록됩니다(권장):

```
/plugin marketplace add IsaacEryn/a11ychk
/plugin install a11ychk@a11ychk
```

- `/a11ychk:a11y-audit` — 검사 → `guide`(한국어 수정 지침)로 코드 수정 → 재검사 루프
- `/a11ychk:kwcag-audit` — KWCAG 2.2 33개 검사항목 관점 점검 (자동/수동 구분 매트릭스)

MCP 서버만 등록하려면:

```bash
claude mcp add a11ychk -- npx -y @a11ychk/mcp
```

그 외 MCP 클라이언트(`.mcp.json`, Cursor 등):

```json
{
  "mcpServers": {
    "a11ychk": { "command": "npx", "args": ["-y", "@a11ychk/mcp"] }
  }
}
```

검사(scan) 도구는 chromium이 필요합니다 (1회 설치, 카탈로그 도구는 없어도 동작):

```bash
npx playwright install chromium
```

설치하지 않아도 서버는 뜹니다 — 검사 도구를 처음 부를 때 설치된 Chrome으로
폴백을 시도하고, 그것도 없으면 정확한 설치 명령을 안내합니다.

공식 MCP 레지스트리에는 [`com.a11ychk/mcp`](https://registry.modelcontextprotocol.io/v0.1/servers?search=com.a11ychk/mcp)로
등재되어 있습니다 (도메인 인증 네임스페이스).

## 도구

| 도구 | 하는 일 | 브라우저 |
|---|---|---|
| `scan_page` | 페이지 1개 검사 — 준수율, 위반(한국어 가이드 동봉), 모범 사례 권고 분리 | 필요 |
| `scan_pages` | 최대 10개 페이지 일괄 검사 | 필요 |
| `crawl_sample` | 대표 페이지 표본 수집 (sitemap·내부 링크, robots.txt 존중) | 불필요 |
| `get_fix_guide` | 규칙 하나의 한국어 개선 가이드·코드 예시·WCAG/KWCAG 매핑 | 불필요 |
| `kwcag_checkpoint` | KWCAG 33항목 하나의 검사 방법·대응 성공기준·자동 판정 규칙 | 불필요 |

판정 기준은 세 진입점(웹·액션·MCP)이 같습니다: WCAG 성공기준에 대응하지 않는
axe 모범 사례 규칙은 준수율·위반 집계에서 빼고 권고로만 보고합니다.

## 이렇게 씁니다

```
> localhost:3000 홈이랑 로그인 페이지 접근성 검사하고 위반 고쳐줘
```

AI가 `scan_pages`를 부르고, 각 위반의 `guide` 필드(한국어 수정 방법)를 읽어 코드를
고친 뒤 재검사로 확인합니다. 사이트 구조를 모르면 `crawl_sample`로 대표 페이지부터
뽑을 수 있습니다.

## 알아둘 것

- 한 호출에 최대 10페이지입니다. 그 이상 규모 — 대표 페이지 자동 수집, KWCAG 33항목
  매트릭스, 수동 판정 워크플로, 인증 준비 보고서(PDF/EARL), 정기 검사 — 는
  [a11ychk.com](https://www.a11ychk.com)의 영역입니다.
- 자동 도구는 접근성 기준의 일부만 검출합니다. 통과가 곧 준수는 아니며, 사람이
  확인해야 하는 항목은 `kwcag_checkpoint`가 검사 방법과 함께 알려줍니다.
- 로컬에서 사용자 권한으로 도는 도구라 웹 서비스의 SSRF 가드를 적용하지 않습니다
  (localhost 검사가 핵심 용도). robots.txt는 표본 수집에서 그대로 존중합니다.
