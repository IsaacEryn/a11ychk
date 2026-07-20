<div align="center">

# A11Y Check · 알리첵

**WCAG 2.2 + KWCAG 2.2를 이중 매핑한 한국어 우선 웹 접근성 자동 점검 엔진**

URL 하나로 대표 페이지를 수집해 접근성을 점검하고, **한국어 개선 가이드**와
AI 코딩 도구용 수정 요청 문서까지 생성하는 오픈소스 서비스입니다.

[![CI](https://github.com/IsaacEryn/a11ychk/actions/workflows/ci.yml/badge.svg)](https://github.com/IsaacEryn/a11ychk/actions/workflows/ci.yml)
[![core: Apache-2.0](https://img.shields.io/badge/core-Apache--2.0-1a7f6e.svg)](packages/core/LICENSE)
[![app: AGPL-3.0](https://img.shields.io/badge/app-AGPL--3.0-1a7f6e.svg)](apps/web/LICENSE)
[![WCAG 2.2](https://img.shields.io/badge/WCAG-2.2%20A%2FAA-1a7f6e.svg)](https://www.w3.org/TR/WCAG22/)
[![KWCAG 2.2](https://img.shields.io/badge/KWCAG-2.2%20(33%ED%95%AD%EB%AA%A9)-1a7f6e.svg)](https://www.wa.or.kr/)

**[🔗 라이브 데모 a11ychk.com](https://www.a11ychk.com)** ·
[점검 사이트 목록](https://www.a11ychk.com/ko/directory) ·
[활용 지표](https://www.a11ychk.com/ko/impact)

*Open-source web accessibility auditing that dual-maps every finding to **WCAG 2.2**
and **KWCAG 2.2** (Korea's national accessibility guidelines), with Korean-language
remediation guides for all 33 KWCAG 2.2 checkpoints.*

</div>

---

## 왜 A11Y Check인가

대부분의 자동 검사 도구는 위반 목록을 영어로 나열하는 데 그칩니다. A11Y Check는 진단에서
멈추지 않고 **개선 작업으로 이어지는 산출물**을 만듭니다.

- 🇰🇷 **KWCAG 2.2 한국어 규칙 카탈로그** — [`packages/core/src/catalog`](packages/core/src/catalog)에
  **106개 규칙**을 WCAG 2.2 성공기준과 **KWCAG 2.2 검사항목(33개)에 이중 매핑**하고, 규칙마다 한국어
  개선 가이드를 담았습니다. 이 카탈로그 자체가 접근성 실무자·개발자에게 독립적으로 유용한 자산입니다.
- 🔧 **진단 → 수정 연결** — 위반마다 한국어 개선 방법 + AI 코딩 도구(Cursor·Copilot 등)에 그대로 투입
  가능한 **수정 요청 문서(Markdown·JSON)**를 자동 생성합니다.
- 🧭 **WCAG-EM 방법론 준수** — 대표 페이지 표본 선정 → 자동 점검 → 점검자 판정 → 통합 준수율까지
  구조화된 평가 절차를 따르고, EARL 리포트로 내보낼 수 있습니다.
- 🙅 **정직한 자동화** — 자동 검사가 확정할 수 없는 항목은 감추지 않고 **수동 검사 방법과 함께 안내**합니다.
  "100% 자동 통과"를 주장하지 않습니다.
- 🧩 **크롬 확장** — 사이드 패널에서 현재 페이지를 실시간 점검하고, 위반을 **페이지 위에 직접** 표시합니다.

> 자동 검사 도구는 접근성 문제의 일부만 찾을 수 있습니다. 이 프로젝트는 그 한계를 명시하고,
> 사람이 확인해야 하는 항목을 검사 방법과 함께 제공하는 것을 원칙으로 합니다.

## 무엇을 하나

| | 기능 |
|---|---|
| **점검** | axe-core + 자체 규칙(리플로우·텍스트 간격·초점·키보드·미디어 등) + 사이트 수준 검사(제목 유일성·일관된 내비·여러 방법) |
| **매핑** | 모든 위반을 WCAG 2.2 성공기준 · KWCAG 2.2 검사항목에 동시 대응 |
| **보고서** | 자동/수동/통합 준수율, KWCAG 33항목 매트릭스, 인증 준비 요약, 전후 비교, PDF·CSV·EARL 내보내기 |
| **개선** | 규칙별 한국어 가이드 + AI 수정 요청 문서(MD/JSON) |
| **확장** | 크롬 MV3 사이드 패널 — 실시간 점검·구조 시각화·장애 시뮬레이션·명도대비 스포이드·전문가 판정 |
| **운영** | 도메인 소유확인, 정기 자동 점검, 회귀 알림, 임베드 배지, 공개 점검 목록 |

## 구조 (npm workspaces 모노레포)

```
packages/core     @a11ychk/core — 검사 엔진 (오픈소스의 심장)
  src/crawler/      대표 페이지 수집 (sitemap → 내부 링크, robots.txt 존중)
  src/scanner/      axe-core 실행·결과 정규화 (Playwright Page 주입형) + 2-패스 안정성 필터
  src/catalog/      106개 규칙 → WCAG 2.2 · KWCAG 2.2 이중 매핑 + 한국어 개선 가이드
  src/manual/       수동 검사 항목 정의 (KWCAG 33개 중 자동 판정 불가 항목)
  src/report/       보고서 집계 (준수율, KWCAG 매트릭스, 사이트 수준 검사)
  src/security/     SSRF 가드 (사설 IP·DNS 리바인딩·redirect 차단), robots.txt 파서
apps/web          Next.js 16 서비스 앱 (a11ychk.com)
apps/extension    크롬 확장 (MV3 Side Panel)
supabase          DB 마이그레이션 + RLS 정책
docs              아키텍처 · 로드맵 · 운영 설정
```

## 시작하기

```bash
npm install
cp apps/web/.env.example apps/web/.env.local   # Supabase 키 등 입력
npx playwright install chromium                 # 로컬 스캔용 브라우저
npm run dev                                     # http://localhost:3000
```

크롬 확장: `npm run build -w @a11ychk/extension` → `apps/extension/dist`를
`chrome://extensions`에서 압축 해제 로드. Supabase 설정은 [docs/SETUP.md](docs/SETUP.md) 참고.

## 기술 스택

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · next-intl(ko/en) ·
Supabase (Auth + PostgreSQL/RLS) · playwright-core + @sparticuz/chromium · axe-core 4.12 · Zod · Vercel

## 테스트

```bash
npm run test                        # core 유닛 테스트 (98개)
npm run test:e2e -w @a11ychk/core   # 실제 크로미엄으로 fixture 스캔 E2E
npm run typecheck && npm run lint
```

## 보안 원칙

- 모든 시크릿은 환경변수로만 관리 — 저장소에는 `.env.example`만 존재
- 사용자 입력 URL은 SSRF 가드(스킴 검증 → DNS resolve → 사설 대역 차단 → 브라우저 DNS 핀 → redirect 재검증)를 통과
- Supabase RLS로 사용자 데이터 격리, service role은 서버에서 권한 검증 후에만 사용
- 검사 횟수 제한(일/주/월) + robots.txt 존중, CSP nonce·표준 보안 헤더 적용

## 기여

규칙 카탈로그([`packages/core/src/catalog`](packages/core/src/catalog))의 한국어 개선 가이드 보강·매핑
교정·새 규칙 제안 PR을 가장 환영합니다. 코드가 아니어도 기여입니다 — [CONTRIBUTING.md](CONTRIBUTING.md) 참고.

도움이 되었다면 ⭐️ **Star**로 프로젝트를 응원해 주세요. 한국어 접근성 도구 생태계를 함께 키웁니다.

## 라이선스

**분할 라이선싱** — 자세한 내용은 [LICENSING.md](LICENSING.md) 참고.

- **검사 엔진·규칙 카탈로그** (`packages/core`) · **크롬 확장** (`apps/extension`) → [Apache-2.0](packages/core/LICENSE):
  자유롭게 사용·수정·재배포·통합할 수 있습니다.
- **서비스 앱** (`apps/web`) → [AGPL-3.0-only](apps/web/LICENSE): 열려 있지만, 이 앱을 수정해
  네트워크 서비스로 운영하면 수정 소스를 공개해야 합니다.

> 이 전환 이전에 배포된 커밋·릴리스는 MIT로 공개되었고 계속 MIT 조건으로 이용할 수 있습니다.
