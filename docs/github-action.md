# GitHub Action으로 접근성 검사 (CI 연동)

A11y Check의 검사 엔진(`@a11ychk/core`, Apache-2.0)을 PR·배포 파이프라인에서 바로
실행할 수 있는 GitHub Action입니다. 지정한 페이지들을 chromium으로 열어 자동 검사
(axe-core + 자체 규칙, WCAG 2.2 AA + KWCAG 2.2)를 수행하고:

- 결과를 **잡 요약(Step Summary)** 에 Markdown 표로 남기고
- `fail-on` 기준을 넘는 위반이 있으면 **잡을 실패**시킵니다 (사전 게시 게이트)

## 사용법

```yaml
name: accessibility
on:
  pull_request:
  workflow_dispatch:

jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: IsaacEryn/a11ychk@v1
        with:
          urls: |
            https://example.com/
            https://example.com/login
          fail-on: serious
```

프리뷰 배포 URL을 검사하려면 배포 스텝의 출력 URL을 넘기면 됩니다:

```yaml
      - uses: IsaacEryn/a11ychk@v1
        with:
          urls: ${{ steps.deploy.outputs.preview-url }}
```

## 입력

| 입력 | 기본값 | 설명 |
|---|---|---|
| `urls` | (필수) | 검사할 페이지 URL — 줄바꿈 또는 쉼표 구분, 최대 20개 |
| `fail-on` | `serious` | 잡 실패 기준: `any`(모든 위반) · `serious`(심각 이상) · `critical`(치명적만) · `none`(보고만) |

## 출력

| 출력 | 설명 |
|---|---|
| `compliance-rate` | 자동 검사 준수율(%) — WCAG 성공기준 기준 |
| `violation-nodes` | 위반 요소 수 (전체 페이지 합산) |
| `violation-rules` | 위반 규칙 수 |
| `advisory-rules` | 모범 사례 권고 규칙 수 |

## 준수율과 권고를 나누는 기준

axe 규칙 중에는 WCAG 성공기준에 대응하지 않는 것들이 있습니다(`landmark-one-main`,
`region`, `heading-order` 등). 지키면 좋지만 적합성 여부와는 별개인 **모범 사례**입니다.

이 액션은 그런 규칙을 준수율과 `fail-on` 판정에서 빼고, 잡 요약의 "모범 사례 권고"
표에 따로 보여 줍니다. a11ychk.com 보고서와 같은 기준이라 두 곳의 점수가 어긋나지
않습니다.

실무에서 이게 중요해지는 지점은 **제3자 위젯**입니다. 캡차나 채팅 위젯이 iframe으로
들어오면 그 안쪽 문서에는 `main`도 `h1`도 없기 마련인데, 내가 고칠 수 없는 남의 마크업
때문에 빌드가 빨개지면 곤란합니다. WCAG 성공기준에 걸리는 위반은 그대로 잡되(예:
확대 차단은 `1.4.4` 위반입니다) 모범 사례는 권고로 남깁니다.

## 버전 고정

| 참조 | 언제 쓰나 |
|---|---|
| `@v1` | 권장. v1 계열의 최신 패치를 자동으로 받습니다 |
| `@v1.0.0` | 완전 고정. 릴리스 내용이 바뀌지 않기를 원할 때 |
| `@main` | 개발 중인 코드. 예고 없이 바뀌므로 파이프라인에 쓰지 마세요 |

## 알아둘 것

- 첫 실행은 의존성 설치 + chromium 다운로드로 2~3분이 걸립니다. 두 번째부터는
  액션이 브라우저를 알아서 캐시하므로(`~/.cache/ms-playwright`) 훨씬 빠릅니다.
- 액션이 잡의 Node를 22로 맞춥니다(검사 엔진 요구 사항). 이어지는 스텝이 다른
  버전을 써야 한다면 액션 뒤에 `actions/setup-node`를 한 번 더 걸어 주세요.
- 자동 도구는 접근성 기준의 일부만 검출합니다(이 프로젝트 자동 커버리지 문서 참고).
  통과가 곧 준수는 아니며, 수동 점검을 병행해야 합니다 — 사이트 단위 검사·수동 판정
  워크플로·인증 준비 보고서는 [a11ychk.com](https://www.a11ychk.com)에서 이용할 수 있습니다.
- 로컬 개발 서버 검사: 워크플로에서 서버를 먼저 띄우고(`npm run dev &` + wait-on)
  `urls: http://localhost:3000/`을 넘기면 됩니다.
