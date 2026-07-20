# Licensing

A11Y Check는 **분할 라이선싱(split licensing)** 모노레포입니다. 디렉터리마다 적용
라이선스가 다르며, 각 디렉터리의 `LICENSE` 파일이 저장소 루트보다 우선합니다
(SPDX/REUSE 관례).

| 디렉터리 | 라이선스 | 대상 |
|---|---|---|
| `packages/core` (`@a11ychk/core`) | **Apache-2.0** | 검사 엔진 · KWCAG 2.2 / WCAG 2.2 규칙 카탈로그 |
| `apps/extension` (`@a11ychk/extension`) | **Apache-2.0** | 크롬 확장 (배포형 클라이언트) |
| `apps/web` | **AGPL-3.0-only** | 서비스 앱 (a11ychk.com) |
| 그 외 · 저장소 루트 | **AGPL-3.0-only** | 배포되는 전체 서비스 기준 |

## 왜 이렇게 나누는가

- **엔진·카탈로그(Apache-2.0)** — 최대한 자유롭게 재사용·인용·통합할 수 있도록
  관대한 라이선스로 공개합니다. 한국어 접근성 도구 생태계에 기여하는 것이 목적입니다.
- **서비스 앱(AGPL-3.0)** — 이 앱을 수정해 네트워크 서비스로 운영하는 경우,
  AGPL은 그 수정 소스를 이용자에게 공개하도록 요구합니다. 오픈소스로 열어두되,
  소스를 닫은 채 동일 서비스를 복제·운영하는 것은 방지합니다.

## Apache-2.0 코드를 AGPL 앱이 사용하는 것에 대하여

`apps/web`(AGPL-3.0)은 `@a11ychk/core`(Apache-2.0)를 의존합니다. Apache-2.0은
GPLv3/AGPLv3와 호환되므로, Apache 라이선스 구성요소를 AGPL 저작물에 포함하는 것은
문제가 없습니다. 반대로 core는 app을 의존하지 않습니다.

## 과거 버전 (MIT)

이 분할 라이선싱 전환 이전에 배포된 커밋과 릴리스는 **MIT 라이선스**로 공개되었으며,
MIT는 소급하여 철회할 수 없습니다. 따라서 해당 시점의 스냅샷은 계속 MIT 조건으로
이용할 수 있습니다. 이후의 변경분부터 위 표의 라이선스가 적용됩니다.

## 기여

기여하신 내용은 해당 디렉터리의 라이선스로 배포됩니다(core·extension = Apache-2.0,
web = AGPL-3.0-only). 자세한 내용은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.
