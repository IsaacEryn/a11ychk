# @a11ychk/mcp 변경 이력

npm 패키지 자체 버전을 따른다 (루트 CHANGELOG.md는 GitHub Action의 버전 축).

## 0.1.1

공식 MCP 레지스트리(registry.modelcontextprotocol.io) 등재를 위한 릴리스입니다.
레지스트리가 npm 패키지 소유를 확인할 때 참조하는 `mcpName` 필드(`com.a11ychk/mcp`)를
package.json에 추가하고, 레지스트리 메타데이터인 server.json을 함께 둡니다.
서버 동작 변경은 없습니다.

## 0.1.0

첫 릴리스. AI 코딩 도구(Claude Code·Cursor 등)에서 웹 접근성 검사를 직접 호출하는
MCP 서버입니다. a11ychk.com과 같은 엔진(axe-core + 자체 규칙)으로 검사하고, 모든
위반을 WCAG 2.2 성공기준과 KWCAG 2.2 검사항목에 함께 매핑하며, 위반마다 한국어
개선 가이드를 돌려줍니다. localhost 개발 서버 검사에 적합합니다.

도구 다섯 개 — `scan_page` / `scan_pages`(chromium 필요), `crawl_sample`,
`get_fix_guide`, `kwcag_checkpoint`(브라우저 불필요).

브라우저는 첫 검사 때 확보합니다. playwright 관리 chromium이 없으면 설치된
Chrome으로 폴백하고, 그것도 없으면 설치 명령을 안내합니다.
