# 아키텍처

## 스캔 파이프라인

```
[사용자] POST /api/scans
  1. 인증 (Supabase Auth) → 2. Zod 입력 검증 → 3. SSRF 가드 (스킴·DNS·사설 IP)
  4. 차단 계정·횟수 제한(24시간 3회 / 7일 10회 / 30일 20회, 롤링 윈도우) → 5. 동시 실행 1건 제한
  6. scans 행 생성(queued) → 202 응답 → after()로 백그라운드 실행
[runScan 오케스트레이터]  (apps/web/src/lib/scan/runScan.ts)
  7. collectPages: robots.txt 확인 → sitemap.xml → 내부 링크 BFS (미확인 5 / 확인 10페이지)
  8. 페이지별: SSRF 재검증 → chromium 로드 → 서브리소스 내부망 차단 route →
     axe.run (WCAG 2.2 AA + BP 태그) → findings 정규화 저장
  9. aggregateScan: impact 집계 + KWCAG 33항목 매트릭스 + 준수율 → scans.summary
[클라이언트] /scans/[id] 에서 2.5초 폴링(aria-live) → 완료 시 보고서로 이동
```

## 왜 이렇게 설계했나

- **core를 Playwright `Page` 주입형으로**: 브라우저 실행은 환경(Vercel 서버리스 /
  로컬 / 크롬 확장)마다 다르므로 엔진은 Page만 받는다. 덕분에 확장·워커 서버로 이식 가능.
- **규칙 카탈로그를 DB가 아닌 코드로**: 버전 관리·PR 기여·타입 안전. 미등록 규칙은
  `getRuleEntry()`가 axe 태그에서 WCAG를 추출해 안전한 기본 항목 생성.
- **두 개의 패키지 엔트리**: `@a11ychk/core`(서버 전용 — node:dns 포함),
  `@a11ychk/core/catalog`(클라이언트 안전 — 순수 데이터/함수). 브라우저 번들에서
  Node 내장 모듈이 섞이는 사고를 구조적으로 차단.
- **횟수 제한을 카운터 테이블 없이**: `scans.created_at` 롤링 윈도우 카운트.
  단순하고 정확하며, `profiles.scan_limit_override`로 사용자별 조정.
- **PDF = 보고서 페이지 재활용**: HMAC 단기 토큰(10분, 스캔 1건 한정)을 붙인 보고서
  URL을 서버리스 chromium이 열어 `page.pdf()`. 스캔과 같은 브라우저 인프라 재사용.

## 보안 계층

| 계층 | 구현 |
|------|------|
| SSRF | `core/src/security/urlGuard.ts` — http/https만, DNS resolve 후 사설·루프백·링크로컬·CGNAT·메타데이터(169.254.169.254) 차단, redirect 매 hop 재검증, 스캔 시 서브리소스 요청도 차단 |
| 크롤링 예절 | robots.txt 파싱·존중, 명시적 UA(a11ychk-bot), 페이지 수 제한 |
| 권한 | RLS(본인 데이터만) + `is_admin()` security definer + 컬럼 grant로 role 자기승격 차단 |
| 시크릿 | 전부 환경변수. service role·INTERNAL_API_SECRET은 서버 전용 (`server-only` import 강제) |
| XSS | 위반 HTML 스니펫은 React 텍스트 노드로만 출력(자동 이스케이프), 길이 제한 저장 |
| 응답 헤더 | X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy |
| 남용 방지 | 일/주/월 횟수 제한, 사용자당 동시 1건, 계정 차단, open redirect 검증(auth callback) |

## 알려진 한계 (의도된 트레이드오프)

- Vercel 함수 시간 제한 내 순차 스캔 → 페이지 수 상한 10. 초과 수요 시 별도 워커로 이전
  (core가 Page 주입형이라 이전 비용 낮음).
- 스캔 진행 표시는 폴링(2.5s). 트래픽 증가 시 Supabase Realtime으로 교체 가능.
- axe `incomplete` 결과는 "확인 필요"로만 표시 — 오탐을 위반으로 단정하지 않는다.
