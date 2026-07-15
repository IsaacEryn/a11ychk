# 기여 가이드 (Contributing)

A11Y Check에 관심 가져주셔서 감사합니다! 이 프로젝트는 **한국어 웹 접근성 생태계를 위한 공공재**를
지향합니다. 코드가 아니어도 기여할 수 있는 방법이 많습니다.

*English speakers: issues and PRs in English are welcome — the rule catalog is Korean-first,
but every entry has an English field too.*

## 가장 가치 있는 기여: 규칙 카탈로그

[`packages/core/src/catalog/`](packages/core/src/catalog/)는 axe-core 규칙과 자체 규칙을
**WCAG 2.2 · KWCAG 2.2에 매핑하고 한국어 개선 가이드**를 담은, 이 프로젝트의 심장입니다.

- **가이드 개선**: 더 명확한 설명, 더 좋은 코드 예시, 실무에서 자주 보는 사례 추가
- **매핑 교정**: WCAG/KWCAG 매핑이 틀렸거나 빠진 곳 제보
- **새 자체 규칙 제안**: axe가 못 잡는 항목의 자동 검사 아이디어 (`a11ychk:` 규칙)
- **번역**: 영문 가이드(`en`) 보강

카탈로그 수정 후에는 반드시 `npm run test`로 매핑 정합성 테스트를 통과시켜 주세요.

## 개발 환경

```bash
npm install
npx playwright install chromium      # E2E·로컬 스캔용
npm run test                         # core 유닛 테스트
npm run test:e2e -w @a11ychk/core    # 실제 크로미엄 E2E
npm run typecheck && npm run lint
```

웹 앱까지 실행하려면 Supabase 설정이 필요합니다 — [docs/SETUP.md](docs/SETUP.md).
검사 엔진(`packages/core`)만 기여한다면 Supabase 없이도 개발·테스트가 가능합니다.

## PR 체크리스트

1. 이슈로 먼저 논의하면 좋습니다 (특히 새 규칙·큰 변경)
2. `npm run test` · `npm run typecheck` · `npm run lint` 통과
3. 규칙 가이드는 한국어(`ko`) 필수, 영어(`en`) 권장
4. 커밋 메시지는 한국어/영어 모두 환영

## 원칙

- **정직한 자동 검사**: 확신할 수 없는 판정은 위반이 아니라 '확인 필요'로 분류합니다.
  오탐(false positive)을 만드는 규칙보다 잡지 않는 규칙이 낫습니다.
- **서비스 자체가 WCAG 2.2 AA 준수 대상**: UI 기여 시 포커스 링·시맨틱 마크업·명도 대비를 지켜주세요.
- 보안 취약점은 공개 이슈 대신 [문의하기](https://a11ychk.com/ko/inquiries)로 알려주세요.

## 라이선스

기여하신 내용은 프로젝트와 동일한 [MIT 라이선스](LICENSE)로 배포됩니다.
