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

준비물은 둘입니다.

- **Node.js 22.19 이상.** `node --version`으로 확인합니다. 이보다 낮으면 서버가 뜨지 않습니다
  ([서버가 뜨지 않을 때](#서버가-뜨지-않을-때)).
- **chromium.** 검사 도구를 쓰려면 처음 한 번 `npx playwright install chromium`을 실행합니다.

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

VS Code의 GitHub Copilot — Copilot 사용자 설정 파일 `~/.copilot/mcp-config.json`에 서버를 추가합니다
(`COPILOT_HOME`을 지정했다면 `$COPILOT_HOME/mcp-config.json`):

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

편집기에서 추가할 수도 있습니다. 채팅 세션에서 Copilot을 고른 뒤 명령 팔레트에서
**Chat: Open Customizations**를 실행하고, **MCP Servers** → **Add Server**에서 **Command (stdio)**를
골라 `npx -y @a11ychk/mcp`를 입력한 다음 저장 위치로 **Global > Copilot Global**을 고릅니다.
팀과 함께 쓰려면 같은 `mcpServers` 항목을 작업 영역 루트의 `.mcp.json`에 둡니다.
`.vscode/mcp.json`은 VS Code가 지원을 끝내기로 한 방식이라 새로 설정할 때는 쓰지 않습니다.
도구를 실행할 때 승인을 묻는 창이 뜰 수 있습니다. 자세한 내용은
[VS Code의 MCP 설정 문서](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)에 있습니다.

그 외 MCP 클라이언트(`.mcp.json`, Cursor 등). GitHub Copilot도 함께 읽는 `.mcp.json`이라면
위의 `type`과 `tools`가 든 항목을 씁니다:

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

### 서버가 뜨지 않을 때

먼저 `node --version`을 봅니다. asdf나 nvm 같은 버전 관리 도구를 쓰면 프로젝트마다 Node.js가
다를 수 있으니, AI 코딩 도구를 연 그 폴더에서 확인합니다.

Node.js가 22.19보다 낮으면 서버는 `Node.js 22.19 이상이 필요합니다`라는 안내를 내고 끝납니다.
AI 코딩 도구에서는 서버 연결 실패로만 보일 수 있습니다. Node.js를 22.19 이상으로 올리고 다시
실행하면 됩니다.

0.2.5까지는 이 안내가 없었습니다. 낮은 Node.js에서는 npx가 최신 버전 대신 옛 0.1.2를 받아 왔고,
서버는 `TypeError: Cannot read properties of undefined (reading 'bind')`
(`undici/lib/interceptor/decompress.js`)로 끝났습니다. 이 오류가 보일 때도 Node.js를 올리면 됩니다.

## 도구

| 도구 | 하는 일 | 브라우저 |
|---|---|---|
| `scan_page` | 페이지 1개 검사 — 준수율, 위반(한국어 가이드 동봉), 모범 사례 권고 분리 | 필요 |
| `scan_pages` | 최대 10개 페이지 일괄 검사 | 필요 |
| `scan_dir` | 로컬 폴더의 정적 HTML 재귀 수집 후 일괄 검사 (최대 10개) | 필요 |
| `crawl_sample` | 대표 페이지 표본 수집 (sitemap·내부 링크, robots.txt 존중) | 불필요 |
| `get_fix_guide` | 규칙 하나의 한국어 개선 가이드·코드 예시·WCAG/KWCAG 매핑 | 불필요 |
| `kwcag_checkpoint` | KWCAG 33항목 하나의 검사 방법·대응 성공기준·자동 판정 규칙 | 불필요 |

판정 기준은 세 진입점(웹·액션·MCP)이 같습니다: WCAG 성공기준에 대응하지 않는
axe 모범 사례 규칙은 준수율·위반 집계에서 빼고 권고로만 보고합니다. 오디오·비디오(유튜브
같은 동영상 임베드 포함)가 없는 페이지는 1.2.x를 '해당 없음'(충족)으로 세고, 여러
페이지를 검사하면 사이트 수준 검사(제목 중복·찾는 방법·내비게이션 일관성)도 준수율에
넣습니다. 실패한 사이트 수준
검사는 결과의 `siteCheckFailures`에 따로 담깁니다.

### 로컬 파일 검사 (`scan_dir`, `scan_page`의 `file://`)

빌드 산출물·정적 사이트·오프라인 웹 문서를 서버 없이 검사할 수 있습니다:

- `scan_dir`에 디렉터리 절대 경로를 주면 `.html`/`.htm`을 재귀 수집해 일괄 검사합니다
  (닷파일·`node_modules`·빌드 캐시 제외, 심링크 미추적).
- `scan_page`에 `file:///절대/경로/index.html`을 직접 넘길 수도 있습니다.
- `file://`에서는 브라우저가 fetch/XHR을 차단하므로 **CSR SPA 산출물은 빈 페이지**로
  뜹니다 — 그런 프로젝트는 dev 서버를 띄우고 URL로 검사하세요. 정적 생성(SSG) 결과물과
  손으로 쓴 HTML이 대상입니다.

검사에는 원본 소스 기반 **마크업 유효성 검사**(KWCAG 8.1.1 — 닫는 태그 누락·잘못된
중첩·속성/id 중복, 위치는 소스 `행:열`)가 포함됩니다.

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
