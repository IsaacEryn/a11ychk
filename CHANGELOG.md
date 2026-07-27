# 변경 이력

여기 붙는 버전 태그는 **GitHub Action**의 버전입니다. 웹 서비스(a11ychk.com)는
계속 배포되므로 따로 버전을 매기지 않고, 크롬 확장은 스토어에서 자체 버전을 씁니다.

## v1.0.0

GitHub Action 첫 정식 릴리스입니다. PR이나 배포 파이프라인에서 지정한 페이지들을
chromium으로 열어 접근성을 자동 검사하고, 위반이 기준을 넘으면 잡을 실패시킵니다.

검사는 axe-core에 자체 규칙(리플로우·텍스트 간격·초점·키보드·미디어·타깃 크기 등)을
더해서 돌고, 결과는 모두 WCAG 2.2 성공기준과 KWCAG 2.2 검사항목에 함께 매핑됩니다.
국제 기준과 한국 지침을 한 번에 봐야 하는 팀을 염두에 뒀습니다.

```yaml
- uses: IsaacEryn/a11ychk@v1
  with:
    urls: |
      https://example.com/
      https://example.com/login
    fail-on: serious
```

- 잡 요약에 심각도·규칙·요소 수·대응 기준을 담은 Markdown 표를 남깁니다
- `fail-on`으로 게이트 강도를 고릅니다 — `any` / `serious`(기본) / `critical` / `none`
- `compliance-rate`, `violation-nodes`, `violation-rules`를 출력으로 내보내 후속
  스텝에서 쓸 수 있습니다
- 브라우저를 캐시하므로 두 번째 실행부터 눈에 띄게 빨라집니다

자동 검사가 접근성 문제 전부를 찾지는 못합니다. 이 액션은 통과했다고 준수라고
말하지 않으며, 사람이 확인해야 하는 항목은 [a11ychk.com](https://www.a11ychk.com)의
수동 판정 워크플로에서 다룹니다.
