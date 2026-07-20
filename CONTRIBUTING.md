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

이 프로젝트는 **분할 라이선싱**입니다([LICENSING.md](LICENSING.md) 참고). 기여하신 내용은
기여한 디렉터리의 라이선스로 배포됩니다:

- `packages/core`(검사 엔진·카탈로그) · `apps/extension`(크롬 확장) → **Apache-2.0**
- `apps/web`(서비스 앱) → **AGPL-3.0-only**

### DCO (Developer Certificate of Origin)

기여 출처를 명확히 하기 위해 커밋에 **sign-off**를 넣어 주세요. 이는 본인이 해당 기여를
제출할 권리가 있음을 [DCO](https://developercertificate.org/)에 따라 확인하는 것입니다.

```bash
git commit -s -m "커밋 메시지"
```

무거운 CLA(저작권 양도) 대신 가벼운 DCO를 사용합니다 — 오픈소스 생태계 관례를 따르면서
기여의 법적 출처를 보증합니다.
