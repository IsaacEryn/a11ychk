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
      - uses: IsaacEryn/a11ychk@main
        with:
          urls: |
            https://example.com/
            https://example.com/login
          fail-on: serious
```

프리뷰 배포 URL을 검사하려면 배포 스텝의 출력 URL을 넘기면 됩니다:

```yaml
      - uses: IsaacEryn/a11ychk@main
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
| `compliance-rate` | 자동 검사 준수율(%) |
| `violation-nodes` | 위반 요소 수 (전체 페이지 합산) |
| `violation-rules` | 위반 규칙 수 |

## 알아둘 것

- 의존성 설치 + chromium 다운로드로 첫 실행에 2~3분이 걸립니다.
  자주 실행한다면 `actions/cache`로 `~/.cache/ms-playwright`를 캐시하세요.
- 자동 도구는 접근성 기준의 일부만 검출합니다(이 프로젝트 자동 커버리지 문서 참고).
  통과가 곧 준수는 아니며, 수동 점검을 병행해야 합니다 — 사이트 단위 검사·수동 판정
  워크플로·인증 준비 보고서는 [a11ychk.com](https://www.a11ychk.com)에서 이용할 수 있습니다.
- 로컬 개발 서버 검사: 워크플로에서 서버를 먼저 띄우고(`npm run dev &` + wait-on)
  `urls: http://localhost:3000/`을 넘기면 됩니다.
