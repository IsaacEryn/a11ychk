# 변경 이력 / Changelog

여기 붙는 버전 태그(v*)는 **GitHub Action**의 버전입니다. 웹 서비스(a11ychk.com)는
계속 배포되므로 따로 버전을 매기지 않고, 크롬 확장은 스토어에서, MCP 서버
(@a11ychk/mcp)는 npm에서 각자 버전을 씁니다 — MCP 변경 이력은
[packages/mcp/CHANGELOG.md](packages/mcp/CHANGELOG.md)에 있습니다.

*Version tags here (v\*) track the **GitHub Action**. The web service ships
continuously and is not versioned; the Chrome extension and the MCP server
(@a11ychk/mcp, see [packages/mcp/CHANGELOG.md](packages/mcp/CHANGELOG.md))
carry their own versions.*

---

## 카탈로그에 없는 규칙의 위반을 놓치던 문제 수정 / Fix violations missed for uncatalogued rules — v1.1.1

### 한국어

규칙 카탈로그에 없는 axe 규칙의 위반이 '모범 사례 권고'로 잘못 분류되고 있었습니다.
권고는 준수율과 `fail-on` 판정에서 빠지므로, **게이트가 막아야 할 위반을 통과시키는**
경우가 생겼습니다. 같은 성공기준의 다른 규칙이 통과하면 실제 위반이 있는 기준이
통과로 보고되기까지 했습니다.

원인은 카탈로그 조회에 axe 태그를 넘기지 않은 것이었습니다. 카탈로그에 없는 규칙은
태그에서 대응 성공기준을 복원하도록 안전망이 있었는데, 정작 그 경로에서 태그가
전달되지 않았습니다. 이제 태그를 관통시켜 카탈로그에 없어도 적합성 위반으로 셉니다.

- 실제로 이 구멍에 빠져 있던 `aria-tab-name`과 랜드마크 규칙 4개를 카탈로그에 추가
  (총 111개) — 한국어 개선 가이드 포함
- 건너뛰기 링크(2.4.1) 검사가 페이지 내 아무 앵커나 통과로 인정하던 것을, 대상이
  본문 영역인 앵커만 인정하도록 조정
- 실행되는 axe 규칙이 모두 카탈로그에 있는지 검사하는 테스트를 추가해 재발 방지

입력·출력 이름과 형식 변경은 없습니다. 이전 버전에서 통과하던 페이지가 이 버전에서
막힐 수 있는데, 그것이 이 수정의 목적입니다.

### English

Violations of axe rules missing from the rule catalogue were misclassified as
best-practice advisories, which are excluded from the compliance rate and the
`fail-on` gate — so the gate could let real violations through. The catalogue
lookup was not receiving axe tags, disabling the fallback that recovers the
mapped success criteria. Tags are now threaded through.

Added the five rules that were actually affected (`aria-tab-name` and four
landmark rules) to the catalogue, tightened the skip-link (2.4.1) check, and
added a test asserting every active axe rule is catalogued. No input or output
changes. Pages that passed before may now fail — that is the point of the fix.

---

## 모범 사례를 준수율에서 분리 / Best-practice rules no longer affect the score — v1.1.0

### 한국어

준수율과 `fail-on` 판정이 a11ychk.com 보고서와 어긋나 있었습니다. WCAG 성공기준에
대응하지 않는 axe 규칙(`landmark-one-main`, `region`, `heading-order` 등)을 웹 보고서는
'권고'로만 보고하는데 액션은 감점 요소로 세고 있었습니다.

이 차이는 **제3자 위젯**에서 특히 크게 벌어졌습니다. 캡차나 채팅 위젯이 iframe으로 들어오면
그 안쪽 문서에는 `main`도 `h1`도 없는 게 보통인데, 내가 고칠 수 없는 남의 마크업 때문에
점수가 깎이고 빌드가 실패할 수 있었습니다.

- 모범 사례 규칙을 준수율·심각도 집계·`fail-on` 판정에서 제외합니다
- 잡 요약에 "모범 사례 권고" 표를 따로 두어 그대로 보여 줍니다
- `advisory-rules` 출력을 추가했습니다
- WCAG 성공기준에 걸리는 위반은 그대로 잡습니다 — 예를 들어 위젯이 화면 확대를 막으면
  `1.4.4` 위반으로 남습니다

`compliance-rate`는 이제 웹 보고서의 자동 준수율과 같은 값(WCAG 성공기준 기준)이고,
`violation-nodes`·`violation-rules`도 권고를 뺀 수치입니다. 임계값을 이 출력에 걸어 두셨다면
한 번 확인해 주세요.

### English

The compliance rate and the `fail-on` gate disagreed with the report on a11ychk.com. axe
rules that map to no WCAG success criterion (`landmark-one-main`, `region`, `heading-order`,
and friends) are reported as advisory on the web, but this action was counting them against
you.

The gap was widest around **third-party widgets**. A captcha or chat widget arrives as an
iframe whose document usually has no `main` and no `h1` — markup you cannot fix, dragging
your score down and potentially failing your build.

- Best-practice rules are excluded from the compliance rate, the severity totals, and the
  `fail-on` decision
- The job summary lists them in a separate "모범 사례 권고" table instead
- New `advisory-rules` output
- Real WCAG failures are still caught — if a widget blocks pinch-zoom, that remains a `1.4.4`
  violation

`compliance-rate` now matches the automated score in the web report (measured against WCAG
success criteria), and `violation-nodes` / `violation-rules` exclude advisory findings. Worth
a look if you gate on those outputs.

---

## 웹접근성 점검 도구 (WCAG + KWCAG 적용) / Web Accessibility Checker (WCAG + KWCAG) — v1.0.0

```yaml
- uses: IsaacEryn/a11ychk@v1
  with:
    urls: |
      https://example.com/
      https://example.com/login
    fail-on: serious
```

### 한국어

GitHub Action 첫 정식 릴리스입니다. PR이나 배포 파이프라인에서 지정한 페이지들을
chromium으로 열어 접근성을 자동 검사하고, 위반이 기준을 넘으면 잡을 실패시킵니다.

검사는 axe-core에 자체 규칙(리플로우·텍스트 간격·초점·키보드·미디어·타깃 크기 등)을
더해서 돌고, 결과는 모두 WCAG 2.2 성공기준과 KWCAG 2.2 검사항목에 함께 매핑됩니다.
국제 기준과 한국 지침을 한 번에 봐야 하는 팀을 염두에 뒀습니다.

- 잡 요약에 심각도·규칙·요소 수·대응 기준을 담은 Markdown 표를 남깁니다
- `fail-on`으로 게이트 강도를 고릅니다 — `any` / `serious`(기본) / `critical` / `none`
- `compliance-rate`, `violation-nodes`, `violation-rules`를 출력으로 내보내 후속
  스텝에서 쓸 수 있습니다
- 브라우저를 캐시하므로 두 번째 실행부터 눈에 띄게 빨라집니다

자동 검사가 접근성 문제 전부를 찾지는 못합니다. 이 액션은 통과했다고 준수라고
말하지 않으며, 사람이 확인해야 하는 항목은 [a11ychk.com](https://www.a11ychk.com)의
수동 판정 워크플로에서 다룹니다.

### English

First stable release of the GitHub Action. It opens the pages you name in chromium,
audits them for accessibility, and fails the job when violations cross the threshold
you set — so problems get caught in review rather than after release.

The engine is axe-core plus our own rules (reflow, text spacing, focus, keyboard,
media, target size, and others). Every finding is mapped to both a WCAG 2.2 success
criterion and a KWCAG 2.2 checkpoint. That dual mapping is the point: if you ship a
product used in South Korea, KWCAG 2.2 is what local reviews and certification are
assessed against, and it does not line up with WCAG one-to-one.

- Writes a Markdown table to the job summary: severity, rule, node count, and the
  criteria each violation maps to
- `fail-on` sets how strict the gate is — `any` / `serious` (default) / `critical` / `none`
- Exposes `compliance-rate`, `violation-nodes`, and `violation-rules` as outputs for
  later steps to use
- Caches the browser, so runs after the first are noticeably faster

Automated testing cannot find every accessibility problem. This action does not claim
that a passing job means conformance; the criteria a person has to judge are handled in
the manual review workflow at [a11ychk.com](https://www.a11ychk.com).
