# A11y Check 로드맵

## Phase 상태

| Phase | 내용 | 상태 |
|-------|------|------|
| 0 | 모노레포 스캐폴드, core 엔진, CI, 오픈소스 공개 | ✅ 완료 |
| 1 | MVP — 인증, 도메인 등록, 스캔 파이프라인, WCAG+KWCAG 보고서, 횟수 제한, 마이페이지 | ✅ 완료 |
| 2 | 정식 오픈 — PDF 다운로드, 도메인 소유 확인, 관리자 콘솔, 문의 | ✅ 완료 (www.a11ychk.com 운영 중) |
| 3 | 크롬 확장 (MV3) — 로그인 필요 페이지 스캔, 수동 점검 체크리스트, 서비스 DB 연동 | ✅ 완료 (apps/extension 0.3.1, 크롬 웹스토어 게시) |
| 4 | 영어/다국어 오픈(en), 정기 스캔 스케줄(Vercel Cron), 접근성 배지 위젯 | ✅ 완료 |
| 5 | 확산·성장 — GitHub Action CI 연동, 비로그인 맛보기 검사, 친구 초대 등급 시스템, 관리자 보안 강화 | ✅ 완료 (아래 상세) |
| 후속 | **AI 개선 가이드** — finding별 LLM 기반 수정 코드 제안 (Claude API), 유료 플랜 결제·패스키 로그인 | 계획만 |

## Phase 5: 정식 오픈 이후 출시 (2026-07)

- **GitHub Action CI 연동** — core(Apache-2.0)를 composite 액션으로 래핑, PR·배포 전
  접근성 검사 게이트. [docs/github-action.md](github-action.md).
- **비로그인 맛보기 검사** — 랜딩에서 로그인 없이 URL 1개(1페이지)를 즉석 검사.
  결과 미저장·내보내기 없음(가입 유도), IP 2회/일 + 전역 100회/일 원자 카운터,
  Turnstile 서버 검증(fail-closed), robots.txt 존중, 위반 위치는 규칙당 1개만
  서버측 트리밍. 관리자 통계(도메인별 수요·평균 준수율·볼륨)는 `teaser_scans`.
- **친구 초대 등급 시스템** — 유효 초대 5명 → 플러스1, +소유확인 도메인·보고서 공개 →
  플러스2 자동 승급(한도 상향). 부정 방지: 이메일 해시 전역 unique·일회용 도메인 차단·
  동일 IP suspect→관리자 승인·일/총 초대 캡. 피초대자에게도 일 한도 +1 즉시 부여.
- **관리자 보안 강화** — ① `ADMIN_PATH_SLUG`로 관리자 경로 은닉(/admin 직접 접근은
  일반 404) ② 관리자 필수 TOTP 2단계 인증(AAL2) ③ 동시 로그인 방지(last-login-wins) +
  로그인 알림 메일 ④ 무활동 20분 자동 로그아웃(HMAC 서명 쿠키). 심층 방어로
  `0027_is_admin_aal2.sql`(RLS에 AAL2 요구, 선택).

## Phase 3: 크롬 확장 설계 메모

- `apps/extension` 워크스페이스, MV3 + `@a11ychk/core/catalog` 공유 (클라이언트 안전 엔트리)
- 인증: 웹 서비스에서 발급한 Supabase 세션 토큰을 `chrome.identity.launchWebAuthFlow`로 수신
- 현재 탭에 axe-core 주입(content script) → 결과를 `POST /api/extension/scans`로 전송
- 수동 점검 체크리스트: `getManualCheckItems()` 데이터로 UI 구성, 체크 상태를 DB 저장
- 로그인 필요 페이지·SPA 내부 상태 등 서버 크롤러가 못 보는 화면을 커버

## 후속: AI 개선 가이드 설계 메모

- finding(선택자 + HTML 스니펫 + 규칙)을 입력으로 수정된 코드 diff 제안
- 모델: Claude API (claude-sonnet-5 이상), 카탈로그 가이드를 시스템 컨텍스트로
- 사용량 과금 문제로 유료 플랜과 함께 도입

## 기술 부채 백로그 (2026-07 코드 리뷰에서 도출)

완료된 항목:

- ~~**API 에러 메시지 국제화**~~ — 완료 (2026-07). `lib/apiError.ts`의
  `apiError()`/`resolveApiLocale()`로 공용화 — 다운로드 라우트는 서버측 번역
  (`?lang=` 우선, Accept-Language 폴백), fetch 클라이언트는 code 우선 번역
  (`scanPage.apiErrors`), 응답 계약 `{ error, code, params }` 하위 호환
- ~~**EARL/Report-Tool 내보내기 로케일**~~ — 완료 (2026-07). `?lang=` 쿼리 반영
  (prose·`@language`), 보고서 링크에 로케일 전달
- ~~**확장 다국어(_locales)**~~ — 완료 (확장 0.2.1). 자체 로더(`src/i18n.ts`) +
  `_locales` ko/en, 환경설정 언어 선택(자동/한국어/English)
- ~~**CSP 헤더**~~ — 완료. next.config가 아닌 `src/proxy.ts`에서 요청별
  nonce + strict-dynamic CSP를 발급한다 (unsafe-inline 제거, GTM 조건부 허용)
- ~~**정기 스캔 큐잉**~~ — 완료. cron은 queued 행 생성만 하고 `drainQueue()`가
  분리 인보케이션으로 소진. 2026-07 후속 개선: 생성도 `createScanForUser`
  재사용으로 통일(좀비 회수·동시 실행 가드·scope 저장 포함), BATCH 3→20

완료된 항목 (추가):

- ~~**CI 연동(GitHub Action)**~~ — 완료 (Phase 5). core를 composite 액션으로
  래핑해 PR에서 접근성 검사 실행. [docs/github-action.md](github-action.md)

남은 항목:

- **보고서 섹션 컴포넌트 분할** — 데이터 로더(loadReport.ts)는 분리 완료,
  JSX 본문(~800줄)의 섹션별 컴포넌트화 + Suspense 스트리밍은 후속
- **EARL 내보내기의 판정 반영** — earl은 자동 판정만, report-tool은 전문가
  판정을 반영해 서로 다른 결과가 나올 수 있음. EARL 페이로드에 명시 또는 통일
- **공용 레이트리밋 스토어** — HTTP 레이트리밋이 인메모리(access-check·맛보기 검사)뿐.
  서버리스 인스턴스 간 공유가 안 되므로 외부 스토어(Upstash 등) 기반으로 승격 검토

## 보고서 고도화 백로그 (2026-07)

- **위반 요소 스크린샷 자동 캡처** (실현 가능 확인됨, 설계 노트):
  - 삽입 지점: `apps/web/src/lib/scan/runScan.ts` `scanSinglePage`의
    `runAxeOnPage` 반환 직후 · `context.close()` 전 — 이 시점에 page가
    살아있고 노드 selector가 확보돼 있음
  - 요구사항: ① 현재 이미지 리소스 차단(메모리 절약) 완화 필요 —
    서버리스 메모리 트레이드오프 ② Supabase Storage 버킷 신규 도입
    ③ `findings.screenshot_path` 마이그레이션 ④ 치명적·심각만
    페이지당 ~10장, 노드당 1–2초 타임아웃, best-effort 권장
- **axe 노드 checks(any/all) 구조화 데이터 보존** — normalize에서 현재
  폐기. 명도 대비의 실제 색상값 등 구조화 진단을 저장하면 AI 수정
  요청의 정밀도 향상 (텍스트로는 failure_summary에 이미 포함)

## 국내 인증 실무 벤치마킹 (2026-07, 반영 완료)

국내 접근성 인증·기관 보고 관행을 조사해 반영한 항목:
- 인증은 종합 점수가 아니라 **검사항목별 준수율 95% 이상** 방식
  → KWCAG 매트릭스에 항목별 페이지 준수율 컬럼 + 95% 기준 안내 (근사치임을 명시)
- 기관 보고는 엑셀 중심 → 위반 목록·매트릭스 CSV 내보내기 (UTF-8 BOM)
- 출력 범위 선택(전체/판정 완료만/오류만) — 웹·인쇄·PDF 일관 적용

보류한 아이디어: 오프라인/소스 단위 진단(크롬 확장이 대체), 사이트 전수
검사 모드(WCAG-EM 2.0 표본 방법론과 충돌 — 표본 확대는 요금제로 대응)
