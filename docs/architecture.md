# 아키텍처

## 스캔 파이프라인

```
[사용자] POST /api/scans
  1. 인증 (Supabase Auth) → 2. Zod 입력 검증 → 3. SSRF 가드 (스킴·DNS·사설 IP)
  4. 차단 계정·횟수 제한(24시간 3회 / 7일 10회 / 30일 20회, 롤링 윈도우) → 5. 동시 실행 1건 제한
  6. scans 행 생성(queued) → 202 응답 → after()로 큐 드레인(drainQueue)
[drainQueue 드레이너]  (apps/web/src/lib/scan/drain.ts)
  claim_scans(MAX): 남은 용량(MAX − running)만큼 oldest queued를 원자적으로 running 전환
  → 각 검사를 내부 엔드포인트 POST /api/internal/run-scan(CRON_SECRET)로 분리 인보케이션에 태움
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
| 봇 방지 | Cloudflare Turnstile — 가입·로그인은 Supabase Auth가, 비로그인 맛보기 검사는 자체 엔드포인트가 siteverify로 서버 검증(fail-closed, `lib/turnstile.ts`) |
| 관리자 다층 보안 | ① `ADMIN_PATH_SLUG` 경로 은닉(proxy rewrite, /admin 직접 접근은 일반 404) ② 필수 TOTP 2단계 인증(AAL2, `lib/adminGuard.ts`) ③ 동시 로그인 방지(MFA 완성 시 다른 기기 세션 철회) + 로그인 알림 메일 ④ 무활동 20분 타임아웃(HMAC 서명 쿠키, `lib/adminIdleCookie.ts`) ⑤ (선택) `is_admin()`에 AAL2 요구(0027) |
| 관리자 가드 위치 | RSC layout이 아닌 **각 admin page의 `requireAdmin`**이 검증 — Next.js는 layout·page를 병렬 렌더하므로 layout 가드만으로는 page의 데이터가 응답에 스트리밍될 수 있음 |

## 동시 부하 대응 (전역 동시성 상한 + DB 큐)

스캔은 헤드리스 chromium을 함수 인보케이션에서 직접 띄우는 무거운 작업이라, 서로 다른
사용자가 동시에 다수 시작하면 Fluid Compute가 인보케이션을 한 인스턴스에 패킹하면서
메모리·동시성 한계에서 무너질 수 있다(OOM → 좀비 running 적체 → 폴링 부하 증가의 연쇄).
이를 **버스트는 큐로 흡수하고 전역 동시 실행은 낮은 상한으로 제한**해 방어한다.

- **전역 상한**: `A11YCHK_MAX_CONCURRENT_SCANS`(기본 3, 무재배포 조절). 동시에 running인
  검사 수의 상한이며, 초과분은 `queued`로 대기한다.
- **원자적 claim**: `claim_scans(p_cap)` 함수(마이그레이션 0020)가 `pg_advisory_xact_lock`으로
  "running 카운트 → claim"을 직렬화하고 `FOR UPDATE SKIP LOCKED`로 경합을 피해, 여러 드레인이
  동시에 돌아도 **전역 running ≤ MAX**를 보장한다.
- **자기 지속 드레인 루프**: 각 검사 완료 후(`/api/internal/run-scan`의 finally)에 재드레인해
  슬롯이 비면 다음 queued를 자동 시작한다. 트리거는 ①검사 생성 ②검사 완료 ③좀비 회수
  (`reclaimStale`) ④일일 크론(백스톱) — 상시 워커 없이 기존 트래픽에 편승해 큐가 빠진다.
- **메모리 격리**: claim된 검사는 내부 HTTP로 분리 인보케이션에 태워 스캔당 독립 메모리
  예산을 확보한다(패킹 OOM 완화). 베이스 URL 미상(로컬)이면 인프로세스로 폴백한다.
- **우아한 저하(UX)**: queued 화면은 "앞에 N명 · 예상 ~M분"을 정직하게 표시하고, 폴링은
  대기가 길어질수록 간격을 늘린다(2.5s→×1.3, 상한 12s). 관리자 대시보드에 동시성 모니터
  (running/queued·최장 대기·상한) 노출.

### 확장 레버 (트래픽 급증 시)

| 지표 트리거 | 레버 |
|------|------|
| OOM율 상승·MAX 상향 필요 | Vercel 함수 메모리 상향(3GB 등) 선반영 후 `A11YCHK_MAX_CONCURRENT_SCANS` 상향 |
| 큐 깊이 상시 누적 | Pro 전환 → 잦은 크론 드레이너(분 단위)·동시성·모니터 강화 |
| 버스트가 함수 층을 압도 | 외부 큐(QStash 등)로 디스패치 이관, 브라우저는 Browserless로 오프로드 |
| 폴링 부하·실시간성 요구 | 폴링 → Supabase Realtime 구독 전환 |

## 비로그인 맛보기 검사 (성장 퍼널)

랜딩에서 로그인 없이 URL 1개(1페이지)를 즉석 검사한다. 본 스캔 파이프라인과 달리 **DB에
검사 기록을 남기지 않고**(어뷰즈 카운터·통계만), 내보내기·수동 검사가 없다. 방어 순서:
캐시(10분, 쿼터 미소비) → Turnstile 서버 검증 → **IP 한도(2/일) 먼저 → 전역 캡(100/일)**
(IP 스팸이 전역 예산을 소모하지 못하게) → robots.txt 존중 → SSRF 가드(DNS 핀 브라우저) →
45초 타임아웃. 위반 위치는 **규칙당 1개만 응답에 실어**(서버측 트리밍) 클라이언트 우회를
막는다. 카운터는 `teaser_usage`(원자 증가, 0011 패턴 미러), 통계는 `teaser_scans`
(호스트명·요약 수치만 — 경로·IP·개인정보 없음). 관리자 페이지에서 도메인별 수요·평균
준수율·볼륨을 본다. (`lib/teaser.ts`, `api/teaser-scan/route.ts`)

## 친구 초대 등급 시스템 (성장 루프)

유효 초대 5명 → 플러스1, 추가로 소유확인 도메인 + 보고서 공개 → 플러스2로 **자동 승급**해
검사 한도를 상향한다. 유효 한도는 필드별 `max(배정 요금제, 달성 등급)` + 초대 보너스로 계산
(`lib/quota.ts`의 `resolveLimits`). 부정 방지: 이메일 정규화 해시 전역 unique·일회용 도메인
차단·동일 IP는 suspect로 보류 후 관리자 승인·일2/총20 캡. 피초대자에게도 일 한도 +1을 즉시
부여하고 부정 기각 시 회수한다. (`lib/referral/`, `0024_referrals.sql`)

## 알려진 한계 (의도된 트레이드오프)

- Vercel 함수 시간 제한 내 순차 스캔 → 페이지 수 상한 10. 초과 수요 시 별도 워커로 이전
  (core가 Page 주입형이라 이전 비용 낮음).
- 스캔 진행 표시는 폴링(대기 길이에 따라 2.5~12s 백오프). 트래픽 증가 시 Supabase Realtime으로 교체 가능.
- axe `incomplete` 결과는 "확인 필요"로만 표시 — 오탐을 위반으로 단정하지 않는다.
