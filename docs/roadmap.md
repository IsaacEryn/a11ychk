# A11Y Check 로드맵

## Phase 상태

| Phase | 내용 | 상태 |
|-------|------|------|
| 0 | 모노레포 스캐폴드, core 엔진, CI, MIT 공개 | ✅ 완료 |
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
