# A11y Check 로드맵

## Phase 상태

| Phase | 내용 | 상태 |
|-------|------|------|
| 0 | 모노레포 스캐폴드, core 엔진, CI, 오픈소스 공개 | ✅ 완료 |
| 1 | MVP — 인증, 도메인 등록, 스캔 파이프라인, WCAG+KWCAG 보고서, 횟수 제한, 마이페이지 | ✅ 완료 (Supabase 연결 후 가동) |
| 2 | 정식 오픈 — PDF 다운로드, 도메인 소유 확인, 관리자 콘솔, 문의, a11ychk.com 배포 | ✅ 코드 완료 / 배포 대기 |
| 3 | 크롬 확장 (MV3) — 로그인 필요 페이지 스캔, 수동 점검 체크리스트, 서비스 DB 연동 | ✅ 완료 (apps/extension, 웹스토어 등록 대기) |
| 4 | 영어/다국어 오픈(en), 정기 스캔 스케줄(Vercel Cron), 접근성 배지 위젯 | ✅ 완료 |
| 후속 | **AI 개선 가이드** — finding별 LLM 기반 수정 코드 제안 (Claude API), 유료 플랜 결제 연동 | 계획만 |

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

우선순위 높은 보안·정합성 항목은 수정 완료. 아래는 남겨둔 개선 항목:

- **API 에러 메시지 국제화** — 라우트 핸들러·서버 액션의 사용자 노출 에러가
  한국어 고정. `saveReview`처럼 에러 코드를 반환하고 클라이언트에서 next-intl로
  번역하는 패턴으로 전환 (`/en` 사용자 경험)
- **EARL/Report-Tool 내보내기 로케일** — 내보내는 JSON의 prose·`@language`가
  `ko` 고정. 요청 로케일을 반영
- **확장 다국어(_locales)** — 패널 UI가 한국어 하드코딩. `chrome.i18n` 전환
  (주입 함수의 라벨은 args로 전달 필요, 약 1~2일 규모)
- **CSP 헤더** — next.config 보안 헤더에 Content-Security-Policy 추가
  (defense-in-depth)
- **정기 스캔 큐잉** — cron이 배치 3건을 한 함수에서 순차 실행. 타임아웃 시
  이후 도메인이 다음 주기까지 밀리는 문제 — `after()` 분산 또는 소배치화
- **보고서 섹션 컴포넌트 분할** — 데이터 로더(loadReport.ts)는 분리 완료,
  JSX 본문(~800줄)의 섹션별 컴포넌트화 + Suspense 스트리밍은 후속
- **EARL 내보내기의 판정 반영** — earl은 자동 판정만, report-tool은 전문가
  판정을 반영해 서로 다른 결과가 나올 수 있음. EARL 페이로드에 명시 또는 통일

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
검사 모드(WCAG-EM 표본 방법론과 충돌 — 표본 확대는 요금제로 대응)
