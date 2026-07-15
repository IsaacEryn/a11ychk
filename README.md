# A11Y Check (a11ychk)

[![CI](https://github.com/IsaacEryn/a11ychk/actions/workflows/ci.yml/badge.svg)](https://github.com/IsaacEryn/a11ychk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-1a7f6e.svg)](LICENSE)
[![WCAG 2.2](https://img.shields.io/badge/WCAG-2.2%20A%2FAA-1a7f6e.svg)](https://www.w3.org/TR/WCAG22/)
[![KWCAG 2.2](https://img.shields.io/badge/KWCAG-2.2%20(33%ED%95%AD%EB%AA%A9)-1a7f6e.svg)](https://www.wa.or.kr/)

**[a11ychk.com](https://a11ychk.com)** — 웹 접근성 자동 점검 보고서 · 개선 가이드 서비스

*Open-source web accessibility auditing with WCAG 2.2 + KWCAG 2.2 (Korean guidelines) mapping
and Korean-language remediation guides. [Impact metrics →](https://a11ychk.com/ko/impact)*

URL 하나로 대표 페이지들을 수집해 **WCAG 2.2 + KWCAG 2.2(한국형 웹 콘텐츠 접근성 지침)** 기준으로
자동 점검하고, 한국어 개선 가이드가 담긴 점검 보고서를 생성합니다. PDF 다운로드·인쇄를 지원하며,
자동으로 판정할 수 없는 항목은 **수동 검사 방법과 함께 정직하게 안내**합니다.

> 자동 검사 도구는 접근성 문제의 일부만 찾을 수 있습니다. 이 서비스는 자동 검사의 한계를 명시하고,
> KWCAG 2.2의 33개 검사항목 중 사람이 확인해야 하는 항목을 검사 방법과 함께 제공합니다.

## 구조 (npm workspaces 모노레포)

```
packages/core     @a11ychk/core — 검사 엔진 (오픈소스의 심장)
  src/crawler/      대표 페이지 수집 (sitemap → 내부 링크, robots.txt 존중)
  src/scanner/      axe-core 실행·결과 정규화 (Playwright Page 주입형)
  src/catalog/      axe 규칙 → WCAG 2.2 · KWCAG 2.2 매핑 + 한국어 개선 가이드
  src/manual/       수동 검사 항목 정의 (KWCAG 33개 중 자동 판정 불가 항목)
  src/report/       보고서 집계 (준수율, KWCAG 매트릭스)
  src/security/     SSRF 가드 (사설 IP·redirect 차단), robots.txt 파서
apps/web          Next.js 16 서비스 앱 (a11ychk.com)
supabase          DB 마이그레이션 + RLS 정책
docs              아키텍처 · 로드맵
```

## 기술 스택

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · next-intl(ko/en) ·
Supabase (Auth + PostgreSQL/RLS) · playwright-core + @sparticuz/chromium · axe-core · Zod · Vercel

## 시작하기

```bash
npm install
cp apps/web/.env.example apps/web/.env.local   # Supabase 키 등 입력
npx playwright install chromium                 # 로컬 스캔용 브라우저
npm run dev                                     # http://localhost:3000
```

Supabase 프로젝트 설정은 [docs/SETUP.md](docs/SETUP.md)를 참고하세요.

## 테스트

```bash
npm run test                        # core 유닛 테스트 (61개)
npm run test:e2e -w @a11ychk/core   # 실제 크로미엄으로 fixture 스캔 E2E
npm run typecheck && npm run lint
```

## 보안 원칙

- 모든 시크릿은 환경변수로만 관리 — 저장소에는 `.env.example`만 존재
- 사용자 입력 URL은 SSRF 가드(스킴 검증 → DNS resolve → 사설 대역 차단 → redirect 재검증)를 통과해야 함
- Supabase RLS로 사용자 데이터 격리, service role은 서버에서 권한 검증 후에만 사용
- 검사 횟수 제한(일/주/월)으로 자원 남용 방지, robots.txt 존중

## 기여

규칙 카탈로그(`packages/core/src/catalog/`)의 한국어 개선 가이드 보강 PR을 가장 환영합니다.
코드가 아니어도 매핑 교정·가이드 개선·새 규칙 제안 모두 기여입니다 — [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

## 라이선스

[MIT](LICENSE)
