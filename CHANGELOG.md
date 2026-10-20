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

## 동적 페이지에서 실제 위반이 빠지던 문제 수정 / Real violations no longer dropped on dynamic pages — v1.3.3

### 한국어

2-패스 안정성 필터는 1차 검사에서 위반이 나온 규칙만 500ms 뒤 다시 실행해, 두 번 모두 같은
선택자로 검출된 요소만 위반으로 확정합니다. 그런데 화면을 다시 그리는 페이지에서는 axe가 같은
요소에 패스마다 다른 선택자를 만들 때가 있습니다. 부모 요소에 활성 상태 클래스가 붙거나 속성
순서가 바뀌는 경우입니다. 그러면 화면에 그대로 있는 저대비 텍스트가 "다시 검출되지 않은 요소"로
분류되어 결과에서 빠졌습니다. 캐러셀이 그 사이 다음 슬라이드로 넘어가 원래 요소가 화면에서
사라져도 같은 일이 생겼습니다.

이제 확정 검사는 선택자 문자열이 아니라 요소 자체를 견줍니다. 선택자가 달라져도 같은 요소면
위반으로 확정하고, 확정 검사 때 요소가 화면에서 사라졌으면(크기 0, 숨김, 잘림, 화면 밖) 다시 잴
수 없었던 것이므로 1차 결과를 그대로 둡니다. 같은 요소가 화면에 남은 채 정상이 된 애니메이션
도중 상태는 지금처럼 걸러집니다. 동적인 페이지에서는 보고되는 위반이 늘 수 있습니다. 웹 서비스와
MCP 서버(0.2.3)도 같은 엔진이라 판정이 함께 바뀝니다. 입력·출력 형식은 그대로입니다.

### English

The two-pass stability filter re-runs only the rules that found violations in the first pass,
500 ms later, and confirms an element only when both passes report it with the same selector. On
pages that re-render, axe sometimes builds a different selector for the same element in each pass,
for example when an active-state class is added to a parent or attribute order changes. Low-contrast
text that stayed on screen was then treated as "not found again" and dropped from the results. The
same happened when a carousel moved to the next slide in between and the original element left the
screen.

The confirming pass now compares elements, not selector strings. An element is confirmed even if its
selector changed, and if it is no longer visible at the confirming pass (zero size, hidden, clipped,
or off screen) the first-pass result is kept because it could not be measured again. Animation
states that resolve while the same element stays on screen are still filtered out. Dynamic pages may
report more violations than before. The web service and the MCP server (0.2.3) share the engine, so
their verdicts change the same way. Input and output formats are unchanged.

---

## 애니메이션 도중의 명도 대비 오탐 줄임 / Fewer contrast false positives during animations — v1.3.2

### 한국어

페이지가 로드되면서 재생하는 페이드인·슬라이드인 같은 애니메이션 도중에 검사가 돌면, 반투명한
중간 상태의 글자색으로 명도 대비를 재서 끝 상태에서는 기준을 충족하는 텍스트가 위반으로 잡힐 수
있었습니다. 기존 2-패스 안정성 필터는 두 번의 측정에서 모두 검출된 요소만 위반으로 확정하지만,
두 측정에 모두 걸칠 만큼 긴 애니메이션은 거르지 못했습니다.

이제 첫 검사 전에, 재생 중인 애니메이션이 끝나길 페이지당 최대 1.5초 기다립니다. 로딩
스피너처럼 반복 횟수가 무한으로 지정된 애니메이션은 기다리지 않고, 타이머로 넘기는 캐러셀은
지금 재생 중인 전환 하나만 기다립니다. 대기에 실패해도 검사는 그대로 진행합니다. 애니메이션이 없는 페이지는 검사 시간이 거의 늘지 않습니다. 웹 서비스와 MCP
서버(0.2.2)도 같은 방식으로 잽니다. 웹 서비스는 애니메이션 감속(prefers-reduced-motion) 흉내도
꺼서, 이제 Action·MCP와 같은 기본 화면을 검사합니다. 감속을 끈 것은 오탐을 줄이기 위해서가
아니라 세 곳이 같은 조건으로 재기 위해서입니다. 입력·출력 형식은 그대로입니다.

### English

If a scan ran while a page was still playing a load animation such as a fade-in or slide-in,
color contrast could be measured on the semi-transparent intermediate color, so text that meets
the requirement in its final state was reported as a violation. The existing two-pass stability
filter only confirms elements found in both passes, but it could not catch animations long enough
to span both measurements.

The first pass now waits up to 1.5 seconds per page for running animations to finish. Animations
set to repeat forever, such as loading spinners, are not waited for, and for a timer-driven
carousel only the transition currently playing is waited for. The scan continues if waiting fails. Pages without animations take about the same time as before. The web
service and the MCP server (0.2.2) measure the same way. The web service also stopped emulating
reduced motion (prefers-reduced-motion), so it now scans the same default view as the Action and
the MCP server. Reduced motion was turned off so that all three measure under the same
conditions, not to reduce false positives. Input and output formats are unchanged.

---

## 광고 iframe 오탐 제거 / Hidden ad frames are no longer reported — v1.3.1

### 한국어

AdSense 같은 광고를 붙인 페이지에서, 화면에 보이지 않는 광고 iframe 안의 빈 문서가
`document-title`·`html-has-lang` 위반(심각)으로 잡히던 문제를 고쳤습니다. 광고 iframe은 원래
검사에서 빼도록 되어 있었지만, 페이지 안의 프레임을 하나씩 따로 검사하는 단계에서는 이 제외
기준이 적용되지 않았습니다. 그래서 실제 위반이 없는 페이지도 준수율이 낮게 나오고, `fail-on:
serious`면 잡이 실패할 수 있었습니다.

이제 프레임별 검사에서도 광고 iframe(과 그 안의 프레임)은 건너뛰고, `display`·`visibility`로
숨었거나 크기가 0×0이라 화면에 그려지지 않는 iframe의 내부 문서도 검사하지 않습니다. iframe
요소 자체에 대한 검사(제목 속성 등)와 화면에 보이는 iframe 내부 검사는 그대로입니다. 웹
서비스와 MCP 서버(0.2.1)도 같은 기준으로 바뀌었습니다. 입력·출력 형식은 그대로입니다.

### English

On pages with ads such as AdSense, empty documents inside ad iframes that are never shown on
screen were reported as serious `document-title` and `html-has-lang` violations. Ad iframes were
already meant to be excluded, but the exclusion was not applied when each frame on the page was
scanned on its own, so pages without real violations scored lower and `fail-on: serious` could
fail the job.

The per-frame scan now skips ad iframes (and frames nested in them) and the documents of iframes
that are not rendered, either hidden with `display`/`visibility` or sized 0×0. Checks on the iframe
element itself (such as its title attribute) and scans of visible iframes are unchanged. The web
service and the MCP server (0.2.1) use the same rule. Input and output formats are unchanged.

---

## KWCAG 검사항목 번호를 표준 원문에 맞춤 / KWCAG checkpoint numbers now follow the standard — v1.3.0

### 한국어

스텝 요약 표의 KWCAG 표기를 인증 심사에서 쓰는 일련번호로 바꿨습니다(예: `KWCAG 검사항목 8`).
그동안 A11y Check가 쓰던 KWCAG 번호 33개 가운데 10개가 KS X OT0003:2022(한국형 웹 콘텐츠 접근성
지침 2.2) 본문의 검사항목 번호와 달랐고, 그중 6개는 표준에서 다른 항목의 번호입니다. 웹 서비스,
MCP 서버(0.2.0), 크롬 확장(0.6.0)도 같은 기준으로 바뀌었습니다. 판정·점수·`fail-on` 동작과 입력·출력
형식은 그대로입니다. 이전에 내려받은 보고서·CSV에 적힌 옛 번호는 아래 표로 읽을 수 있습니다.

| 검사항목(일련번호) | 표준 번호 | 옛 A11y Check 번호 |
|---|---|---|
| 표의 구성 (3) | 5.3.1 | 7.3.2 |
| 콘텐츠의 선형구조 (4) | 5.3.2 | 7.3.1 |
| 명확한 지시사항 제공 (5) | 5.3.3 | 5.3.2 |
| 색에 무관한 콘텐츠 인식 (6) | 5.4.1 | 5.3.1 |
| 텍스트 콘텐츠의 명도 대비 (8) | 5.4.3 | 5.4.1 |
| 콘텐츠 간의 구분 (9) | 5.4.4 | 5.4.3 |
| 오류 정정 (28) | 7.3.1 | 7.4.2 |
| 레이블 제공 (29) | 7.3.2 | 7.4.1 |
| 접근 가능한 인증 (30) | 7.3.3 | 7.4.3 |
| 반복 입력 정보 (31) | 7.3.4 | 7.4.4 |

나머지 23개는 번호가 같습니다. 표의 구성과 콘텐츠의 선형구조는 원칙도 '이해의 용이성'에서
'인식의 용이성'으로 바로잡았습니다.

### English

The step summary now cites KWCAG checkpoints by the serial numbers used in Korean certification
audits (e.g. `KWCAG 검사항목 8`; the summary is in Korean, where 검사항목 means "checkpoint").
Ten of the 33 KWCAG numbers A11y Check used did not match the checkpoint numbers in
KS X OT0003:2022, and six of them are numbers of different checkpoints in the standard. The web
service, the MCP server (0.2.0), and the Chrome extension (0.6.0) follow the same numbering.
Verdicts, scores, `fail-on`, and input/output formats are unchanged. The table above maps the old
numbers in earlier reports and CSV files to the standard numbers (columns: checkpoint (serial),
standard number, old A11y Check number).

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
