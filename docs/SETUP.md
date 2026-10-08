# 운영 환경 설정 가이드

## 1. Supabase 프로젝트

1. [supabase.com](https://supabase.com/dashboard)에서 새 프로젝트 생성 (리전: Northeast Asia 권장)
2. **SQL Editor**에서 `supabase/migrations/`의 파일을 **번호 순서대로 전부** 실행
   (`0001`부터 최신까지). 각 마이그레이션은 앞선 것에 의존하므로 건너뛰지 말 것.
   특별히 유의할 마이그레이션:
   - `0001_initial_schema.sql` — 기본 스키마·RLS·`is_admin()`
   - `0002_scheduled_scans.sql` — 정기 스캔용 (안 하면 정기 스캔만 비활성)
   - `0003_wcag_em.sql` — **WCAG-EM 평가 범위·표본 + 요금제 설정 — 새 검사 실행에 필수** (방법론 참조는 현재 2.0 기준)
   - `0004_reviews_meta.sql` — **점검자 판정 기입·보고서 정보 — 평가 워크벤치 기능에 필수**
   - `0024_referrals.sql` — 친구 초대 등급 시스템 (초대 기록·부정 방지)
   - `0025_teaser_usage.sql` — 비로그인 맛보기 검사 어뷰즈 카운터 (안 하면 맛보기만 비활성)
   - `0026_teaser_stats.sql` — 맛보기 검사 관리자 통계
   - `0027_is_admin_aal2.sql` — **관리자 RLS에 2단계 인증(AAL2) 요구 — 관리자 TOTP 등록을 마친 뒤 적용할 것.** 미적용이면 비밀번호만 탈취해도 PostgREST로 직접 전체 데이터를 읽을 수 있다 (아래 "관리자 2단계 인증" 참고)
   - `0033_scan_presets.sql` — 검사 옵션 프리셋 (안 하면 프리셋 저장만 비활성)
   - `0035_rpc_grants.sql` — **SECURITY DEFINER 함수의 anon·authenticated 실행 권한 회수 — 보안상 필수**
   - `0037_domains_insert_columns.sql` — **domains INSERT를 (user_id, hostname)으로 한정 — 보안상 필수.** 미적용이면 로그인 사용자가 PostgREST로 `verified=true`인 도메인 행을 직접 넣어 소유 확인(배지·공개 등재·정기 검사·robots 예외)을 위조할 수 있다. 적용 후 파일 끝의 점검 SQL로 기존 위조 행을 확인할 것
   - `0038_scheduled_scan_candidates.sql` — 정기 검사 후보를 SQL에서 계정당 1개·기한 초과 순으로 고른다(안 하면 크론이 창 500 + JS 선택으로 폴백하고, 창이 차면 app_errors에 기록)
   - `0040_scan_source_extension.sql` — 확장으로 만든 보고서를 웹 검사 한도에서 뺀다(미적용이면 확장 보고서가 웹 검사 횟수에서도 차감되고, 저장할 때마다 app_errors에 한 줄 남는다). 코드 배포 **전에** 적용하고, 배포 직후 파일의 UPDATE 문을 한 번 더 실행해 그 사이에 저장된 확장 보고서를 백필한다
   - `0041_billing.sql` — 결제·구독·기관 계약 테이블과 RLS. 미적용이면 구독·기관 계약이 이용 권한에 반영되지 않고 관리자 결제 화면이 "마이그레이션 적용 필요"로 표시된다. 가격 행은 들어 있지 않다
3. **Authentication → Providers**에서 Google, GitHub OAuth 활성화
   - Google: [Google Cloud Console](https://console.cloud.google.com)에서 OAuth 클라이언트 생성,
     승인된 리디렉션 URI에 `https://<프로젝트>.supabase.co/auth/v1/callback` 추가
   - GitHub: Settings → Developer settings → OAuth Apps에서 동일하게 설정
4. **Authentication → URL Configuration**
   - Site URL: `https://a11ychk.com`
   - Redirect URLs: `https://a11ychk.com/auth/callback`, `http://localhost:3000/auth/callback`
5. **Settings → API**에서 URL·anon key·service_role key 복사 → 환경변수로

## 2. 환경변수 (Vercel → Settings → Environment Variables)

`apps/web/.env.example` 참고. **service_role key와 INTERNAL_API_SECRET은 절대 클라이언트/저장소에 노출 금지.**

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY        # 서버 전용
INTERNAL_API_SECRET              # openssl rand -hex 32
CRON_SECRET                      # 정기 스캔 크론 보호 (openssl rand -hex 32)
NEXT_PUBLIC_SITE_URL=https://www.a11ychk.com
RESEND_API_KEY                   # 이메일 발송 (정기 스캔 회귀 알림·서버 오류 알림) — 미설정 시 발송 생략
KV_REST_API_URL / KV_REST_API_TOKEN  # (선택) HTTP 레이트리밋 공유 스토어 — Vercel 마켓플레이스 Upstash Redis 설치 시 자동 주입. 없으면 인스턴스 메모리 카운터(best-effort)
NEXT_PUBLIC_TURNSTILE_SITE_KEY   # Cloudflare Turnstile 사이트 키 — 아래 "봇 방지" 절 참고
TURNSTILE_SECRET_KEY             # 같이 필수 — 맛보기 검사 서버 검증(siteverify)용
NEXT_PUBLIC_GTM_ID                # GTM 컨테이너 ID(GA4) — 미설정 시 분석 스니펫 미삽입
ADMIN_ALERT_EMAIL                # 서버 오류·관리자 로그인 알림 수신 주소 — 미설정 시 발송 생략
ADMIN_PATH_SLUG                  # (선택) 관리자 비밀 경로 슬러그 — 설정 시 /admin은 404 (점 금지)
ADMIN_IDLE_MINUTES               # (선택) 관리자 무활동 자동 로그아웃 분 (기본 20)
SESSION_MAX_HOURS                # (선택) 전 회원 세션 절대 유지 시간 (기본 24)
```

결제 관련 변수(`BILLING_MODE`, `TOSS_*`, `BILLING_KEY_ENC_KEY`, `BILLING_TEST_USER_IDS`)는 기본이 꺼짐이고
Production에는 넣지 않는다. 설정은 아래 "결제 테스트(토스)" 절을 따른다.

### 봇 방지 (Cloudflare Turnstile)

비로그인 맛보기 검사는 요청마다 헤드리스 브라우저를 띄우므로 봇에 열려 있으면 비용이
그대로 나간다. 로그인·가입 폼도 같은 위젯으로 보호한다.

1. Cloudflare 대시보드 → Turnstile에서 위젯을 만들고 호스트명에 운영 도메인을 등록한다.
2. Vercel → Settings → Environment Variables에 두 값을 넣는다.
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — 공개 사이트 키
   - `TURNSTILE_SECRET_KEY` — 시크릿 키
3. **재배포한다.** 사이트 키는 `NEXT_PUBLIC_` 접두라 빌드 시점에 코드로 박힌다. 환경변수만
   바꾸고 재배포하지 않으면 위젯이 계속 렌더되지 않는다.
4. Supabase 대시보드 → Authentication → Attack Protection에서 CAPTCHA 보호를 켜고 **같은
   시크릿 키**를 넣는다. 이걸 켜지 않으면 로그인 폼이 보내는 토큰을 아무도 검증하지 않는다.

설정이 끝나면 Cloudflare Turnstile 위젯 화면에서 siteverify 호출이 잡히는지 확인한다.
"Siteverify isn't being called" 경고가 남아 있으면 서버 검증이 실제로는 안 돌고 있다는 뜻이다.

키가 빠진 배포본에서는 맛보기 검사가 503으로 비활성되고 관리자 오류 로그에 원인이 남는다
(예전에는 조용히 전부 통과시켰다). CAPTCHA 없이 운영하려면 `TURNSTILE_DISABLED=1`로
의도를 명시할 것 — 그 경우 맛보기 검사의 방어는 IP 일 한도와 전역 일 상한만 남는다.

### 관리자 2단계 인증(TOTP) 복구

관리자 계정은 TOTP 등록·검증 없이는 관리자 페이지에 접근할 수 없습니다(웹이 자동으로
등록 화면을 안내). 인증 앱을 분실했다면 다음 중 하나로 factor를 삭제하세요 —
삭제 후 다음 관리자 접근 시 등록 화면이 다시 나옵니다.

1. Supabase Dashboard → Authentication → Users → 해당 사용자 → MFA factors 삭제
2. SQL Editor: `delete from auth.mfa_factors where user_id = '<관리자 uuid>';`

migration 0027을 적용하면 관리자 RLS가 AAL2 세션을 요구하므로,
**반드시 TOTP 등록을 마친 뒤** 적용하세요.

## 크롬 확장 빌드 (Phase 3)

```bash
A11YCHK_SITE_ORIGIN=https://www.a11ychk.com npm run build -w @a11ychk/extension
# → apps/extension/dist 를 chrome://extensions에서 "압축해제된 확장 프로그램 로드"로 설치
```

빌드는 Supabase 공개값(URL·anon 키)도 번들에 넣는다 — 확장이 세션 교환·갱신에 직접 쓴다.
`A11YCHK_SUPABASE_URL`/`A11YCHK_SUPABASE_ANON_KEY`(또는 `NEXT_PUBLIC_SUPABASE_*`) 환경변수가
없으면 `apps/web/.env.local`의 같은 이름을 읽고, 그것도 없으면 빌드가 실패한다.
웹스토어 제출용 zip은 `cd apps/extension/dist && zip -r ../a11ychk-extension-<버전>.zip .`

확장은 웹의 `/{locale}/extension/connect` 페이지에서 계정과 연결됩니다.

## 정기 스캔 (Phase 4)

- `apps/web/vercel.json`의 cron이 매일 `/api/cron/scheduled-scans`를 호출합니다.
- Vercel이 `CRON_SECRET`을 Authorization 헤더로 자동 전송하므로 환경변수만 설정하면 됩니다.
- 사용자가 대시보드에서 도메인별 "정기 검사 켜기"를 해야 대상이 됩니다. **소유를 확인한 도메인만** 켤 수 있고
  크론도 소유 확인 도메인만 검사합니다(예전에 미확인으로 켜 둔 도메인은 대시보드에 "대기"로 보임).
- 정기 검사는 사용자 검사 한도를 쓰지 않습니다. 대신 사용자당 활성 검사 1건 가드 때문에 **계정당 하루 1개 도메인**이
  상한이고, 한 계정에 여러 도메인이 있으면 기한을 가장 많이 넘긴 것부터 하루에 하나씩 돕니다(0038·`pickScheduledDomains`).
- 크론 결과는 `cron_runs.summary`에 남습니다 — `counts`(상태별 합계), `pausedUnverified`(미확인이라 멈춘 도메인 수),
  `deferred`(폴백 경로에서 기한이 됐지만 못 고른 수), `candidateWindowFull`. 예:
  `select started_at, summary->'counts', summary->'pausedUnverified' from cron_runs where job='scheduled-scans' order by started_at desc limit 7;`
- 회귀 알림은 같은 도메인의 직전 **정기** 검사와 자동 준수율로 비교합니다(표본 조건이 다르거나 일부만 끝난 검사면 신규 위반 비교 생략).
  `scans.source`(0029)가 없으면 알림이 멈추므로 `select source, count(*) from scans where created_at > now() - interval '3 days' group by 1`로 `scheduled` 행을 확인할 것.

## 결제 테스트(토스)

토스페이먼츠 정기결제(빌링키)를 테스트 키로 끝까지 돌려 보는 절차다. 결제 기능은 환경변수
`BILLING_MODE`가 여닫는 하드 게이트이고 기본은 꺼짐(`off`)이다. 꺼진 환경에서는 결제 화면도
결제 크론도 결제사를 호출하지 않는다.

### 준비

1. **키 발급** — 토스페이먼츠 개발자센터(developers.tosspayments.com) → 내 개발 정보 → API 키.
   자동결제(빌링)는 "결제위젯 연동 키"가 아니라 **"API 개별 연동 키"**(`test_ck_…` / `test_sk_…`)를 쓴다.
   클라이언트 키는 결제창을 여는 서버 액션의 응답으로만 브라우저에 전달된다(`NEXT_PUBLIC_` 변수를 만들지 않는다).
2. **환경변수** — `apps/web/.env.local`에만 넣는다(`apps/web/.env.example`의 결제 블록 참고).

   ```
   BILLING_MODE=test
   TOSS_CLIENT_KEY=test_ck_...
   TOSS_SECRET_KEY=test_sk_...
   BILLING_KEY_ENC_KEY=              # openssl rand -base64 32
   BILLING_TEST_USER_IDS=            # 결제해 볼 일반 계정 UUID(쉼표 구분). 관리자는 자동 허용
   ```

   - 키 접두(`test_` / `live_`)가 `BILLING_MODE`와 다르면 `off`로 동작한다. 프로덕션에 테스트 키를 넣어
     공짜 구독이 생기거나 로컬에 실키를 넣어 실제로 돈이 나가는 사고를 막는 장치다.
   - `BILLING_KEY_ENC_KEY`는 빌링키를 암호화(AES-256-GCM)하는 32바이트 키다. 바꾸면 이미 저장된 빌링키를
     풀 수 없어 그 구독의 갱신 결제가 실패한다.
   - 관리자 계정은 한도가 무제한이라 Pro 한도 변화가 가려진다. 화면 확인은 `BILLING_TEST_USER_IDS`에 넣은
     일반 계정으로 한다.
   - 환경변수를 바꾸면 개발 서버를 다시 띄운다. 키 값은 어디에도 출력·기록하지 않는다.
3. **마이그레이션 0041** — 적용 전에 SQL Editor에서 `select to_regclass('public.subscriptions');`를 실행한다.
   `NULL`이면 아직 적용되지 않은 것이니 `supabase/migrations/0041_billing.sql`을 SQL Editor에서 실행한다.
   테이블 이름이 나오면 이미 적용된 DB다. 0041 없이도 서비스는 동작한다(구독이 권한에 반영되지 않고 관리자
   결제 화면이 "마이그레이션 적용 필요"를 보여 줄 뿐이다). 0041에는 가격 행이 없다.
4. **가격 행** — 관리자 → 결제·계약 → 가격에서 추가한다. 플랜(Pro), 결제 주기(월간), 금액, 모드를 **테스트**로 두고
   활성으로 저장한다. 가격 행은 불변이다: 금액을 바꾸려면 새 행을 만들고 이전 행을 비활성한다.
   같은 플랜·주기·모드에서 활성 행은 하나뿐이다. 금액은 이 문서나 저장소에 적지 않고 이 화면에서만 넣는다.

### 로컬에서 끝까지 돌려 보기

`npm run dev`로 띄운 로컬 서버에서 한다(로그인 주의는 아래 "운영 주의" 참고). test 모드의 가격·결제 화면은
관리자와 `BILLING_TEST_USER_IDS` 계정에게만 보인다. 공개 범위 플래그로는 열 수 없다.

1. 일반 테스트 계정으로 로그인해 `/ko/pricing`에서 가격을 확인하고 **구독하기**를 누른다.
2. 결제 확인 화면(`/ko/billing/checkout`)에서 정기결제 동의 체크를 하고 계속한다.
3. 토스 테스트 결제창에서 테스트 카드로 인증한다. 테스트 카드 번호는 토스페이먼츠 개발자 문서의 테스트
   결제 안내를 본다(여기에는 적지 않는다).
4. `/ko/mypage/billing?result=subscribed`로 돌아온다. 영수증 메일(제목에 `[TEST]` 표기)이 오고
   마이페이지에 Pro 한도가 보인다.
5. **갱신 확인** — 관리자 → 결제·계약 → 테스트 도구에서 그 구독의 "결제일 당기기"를 누른 뒤(미납 구독은
   "재시도 시점 당기기", 결제 예정 안내 메일은 "안내 시점으로 당기기") 같은 화면의 "결제 크론 지금 실행"을
   누른다. 기간이 한 주기 앞으로 가고 영수증 메일이 온다. Vercel 크론은 로컬에서 돌지 않으므로 이 버튼이
   크론 대신이다. 당기기는 테스트 결제 구독에만 된다.
6. **해지 확인** — 결제 관리(`/ko/mypage/billing`)에서 해지 예약(종료일 안내·메일) → 해지 취소 → 다시 해지 예약 →
   결제일 당기기 → 크론 실행. 구독이 끝나고 권한이 무료로 돌아가야 한다.
7. 카드 변경과, 결제창에서 취소했을 때(결제 확인 화면에 오류 문구) 흐름도 같은 화면에서 본다.

### 결제 크론

`apps/web/vercel.json`의 `/api/cron/billing`이 매일 01:00 UTC(10:00 KST)에 호출된다. Vercel이
`CRON_SECRET`을 Authorization 헤더로 보내므로 정기 스캔과 같은 환경변수 하나로 보호된다. Vercel Hobby
플랜은 지정 시각을 지키지 않고 앞뒤 59분 안 어느 때든 부를 수 있다. 갱신 결제를 기간 끝 하루 전부터
시도하는 것은 하루 한 번 도는 크론의 지연을 흡수하기 위해서다.

모드에 따라 다루는 행이 다르다. `off`는 처리 없이 `{"skipped":"off"}`만 기록하고, `test`는 테스트 결제 행
(`livemode=false`)만, `live`는 실결제 행만 다룬다. 한 번 실행하면 코드 순서대로 이렇게 처리한다.

1. **대사** — 10분 넘게 결과를 모르는(`pending`) 결제를 토스 주문 조회로 확정한다(결제됨 / 실패 / 환불됨).
   조회가 실패하거나 토스에서도 진행 중이면 `pending`으로 두고 다음 날 다시 본다.
2. **후보 조회** — 진행 중인 토스 구독 중 기간 끝이 지금부터 31일 안인 것(이미 지난 것 포함)을 기간 끝이 이른 순서로 최대 500건 읽는다.
3. **후보마다 판정·처리**
   - 해지 예약이 있으면 결제하지 않고, 기간 끝이 지나면 구독을 끝낸다.
   - 정상 구독은 기간 끝이 가까워지면 결제 예정 안내 메일을 한 번 보내고, 기간 끝 하루 전부터 결제한다.
     성공하면 기간을 한 주기 전진시키고 영수증을 보낸다.
   - 미납 구독은 재시도 시각이 되면 다시 결제하고, 유예가 끝나면 끝낸다.
   - 구독을 끝낼 때 결과를 모르는 결제가 걸려 있으면 끝내지 않고 보류한다(그 결제가 실제로 청구됐을 수 있다).
     끝내면 빌링키를 지우고 종료 메일을 보낸다.
4. **예산** — 240초를 넘기면 멈추고 남은 건은 다음 날로 미룬다(`deferred`). 같은 코드의 설정 사고(암호화 키
   문제 등)가 연달아 나면 그 실행의 결제·재시도를 멈춘다(`halted`). 종료·안내는 계속한다.

안내 시점·재시도 간격·유예 기간은 `apps/web/src/lib/billing/period.ts`에 있다. 실행 결과는 `cron_runs`에 남는다:
`select started_at, ok, summary from cron_runs where job='billing' order by started_at desc limit 7;`

**조용히 멈추지 않게 하는 장치** — 모드가 켜졌는데 토스 키나 `BILLING_KEY_ENC_KEY`가 없으면 크론은 건너뛰지
않고 실패(`billing cron not configured`)로 기록하고 오류 응답을 낸다. 그리고 정기 스캔 크론(매일 18:00 UTC)이
끝날 때 결제 크론의 마지막 **성공** 실행을 확인해 26시간을 넘겼으면 `ADMIN_ALERT_EMAIL`로 경보를 보낸다.
`off`에서도 결제 크론은 성공으로 기록되므로 꺼진 것과 멈춘 것이 구분된다.
실행 기록이 아예 없으면(0030 미적용 등) 멈춘 것으로 보지 않는다.

### 운영 주의

- **Production·Preview에는 `BILLING_MODE`를 넣지 않는다.** 로컬·프리뷰·프로덕션이 DB 하나를 같이 쓴다. 테스트 결제
  행은 `livemode=false`로 구분되고, test 모드는 그 행도 이용 권한에 반영한다. test 모드는 로컬에만 둔다.
- **돌아올 주소** — 결제창이 성공·실패 후 돌아올 주소는 요청의 `Host` 헤더로 만든다. `x-forwarded-host`가 있으면
  `Host`와 같아야 하고, 다르면 결제 시작을 만들기 전에 멈춘다(fail closed). 프로토콜은 `x-forwarded-proto`를
  따르며 https만 받는다(로컬 개발 호스트만 http). 그래서 `Host`를 다시 쓰는 프록시 뒤에서는 결제 시작이 실패하고
  `app_errors`에 `billing checkout refused: request origin is not a valid http(s) host`가 남는다. `x-forwarded-host`가
  붙는 환경(Vercel 프리뷰 배포 포함)에서도 두 값이 같으면 그 배포의 호스트로 돌아온다.
- **결제를 끄면(`off`)** 실결제 구독이 남아 있어도 사용자 화면에서 해지·해지 취소·카드 변경을 할 수 없고, 결제
  크론은 아무것도 하지 않는다. 다시 켜면 그동안 기간 끝이 지난 구독은 **다음 크론 실행에서 바로 결제가 나갈 수 있다.**
  끄기 전에 구독자에게 알리고, 다시 켜기 전에 구독자를 확인해 안내한다.
- **회원 탈퇴** — 탈퇴하면 진행 중인 토스 구독(테스트·실결제 모두)이 사용자 해지로 끝나고 빌링키가 지워진다(메일 없음).
  결제 상태는 탈퇴를 막지 않는다. 결과를 모르는 결제가 남은 채 탈퇴하면 `app_errors`에
  `billing needs review: account deleted with pending payment…`가 남으니, 토스 상점관리자와 대사한 뒤 환불 여부를 정한다:
  `select created_at, message from app_errors where message like 'billing needs review:%' order by created_at desc;`
  구독·결제·동의 기록은 `user_id`만 비워서 남는다. 고객 행(빌링키 암호문)은 계정과 함께 지워진다.
- **로컬 로그인** — 로그인 폼의 Turnstile 위젯이 통과하려면 `localhost`가 위젯의 허용 도메인에 있어야 한다.
  Cloudflare 대시보드 → Turnstile → 해당 위젯의 호스트명에서 설정한다.
- **관리자 경로 슬러그** — `ADMIN_PATH_SLUG`에 `billing`을 쓸 수 없다(예약된 경로). 슬러그 값은 어디에도 적지 않는다.

### 라이브 전환 체크리스트

라이브는 코드 배포가 아니라 설정 작업이다. 아래를 순서대로 모두 마친 뒤에만 연다.

1. 토스페이먼츠 라이브 키(`live_ck_…` / `live_sk_…`)를 발급받는다.
2. 테스트와 **다른** `BILLING_KEY_ENC_KEY`를 새로 만든다. 같은 값을 재사용하지 않는다.
3. Vercel **Production**에만 `BILLING_MODE=live`와 위 세 값을 넣고 재배포한다. Preview·Development에는 넣지 않는다.
4. 관리자 → 결제·계약 → 가격에서 모드를 **실결제**로 가격 행을 추가한다. 테스트 행과 별개이고, 사용자에게 보이는 금액이다.
5. 공개하기 전에 관리자 계정으로 **실제 카드 결제와 환불**을 한 번 해 본다. 공개 범위(아래 6번)가 닫혀 있어도
   관리자는 결제해 볼 수 있다. 결제 확인 화면, 영수증 메일, 결제 관리 화면, 토스 상점관리자의 내역을 확인하고,
   시험 구독은 해지한 뒤 토스 상점관리자에서 환불한다.
6. 공개 범위는 `app_settings`의 `billing` 행이 정한다. 기본은 둘 다 닫힘이다. 가격 표시(`showPrices`)와 결제 시작
   (`checkoutOpen`)을 SQL Editor에서 연다.

   ```sql
   update public.app_settings
   set value = '{"showPrices": true, "checkoutOpen": true}'::jsonb
   where key = 'billing';
   ```

## 3. Vercel 배포

1. GitHub 저장소 연결, **Root Directory를 `apps/web`으로 지정**
2. Fluid Compute 활성화 확인 (스캔 오케스트레이터가 `after()`로 최대 300초 실행)
3. 도메인 a11ychk.com 연결

## 4. 관리자 지정

가입 후 Supabase SQL Editor에서:

```sql
update public.profiles set role = 'admin' where id = '<본인 auth.users id>';
```

## 5. 로컬 개발

```bash
npm install
cp apps/web/.env.example apps/web/.env.local  # 위 값 입력
npx playwright install chromium
npm run dev
```

로컬에서는 playwright 패키지의 chromium으로 스캔합니다. 다른 크롬을 쓰려면
`A11YCHK_CHROME_PATH`를 지정하세요.
