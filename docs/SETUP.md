# 운영 환경 설정 가이드

## 1. Supabase 프로젝트

1. [supabase.com](https://supabase.com/dashboard)에서 새 프로젝트 생성 (리전: Northeast Asia 권장)
2. **SQL Editor**에서 마이그레이션을 순서대로 실행
   - `supabase/migrations/0001_initial_schema.sql`
   - `supabase/migrations/0002_scheduled_scans.sql` (정기 스캔용 — 안 하면 정기 스캔만 비활성)
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
```

## 크롬 확장 빌드 (Phase 3)

```bash
A11YCHK_SITE_ORIGIN=https://www.a11ychk.com npm run build -w @a11ychk/extension
# → apps/extension/dist 를 chrome://extensions에서 "압축해제된 확장 프로그램 로드"로 설치
```

확장은 웹의 `/{locale}/extension/connect` 페이지에서 계정과 연결됩니다.

## 정기 스캔 (Phase 4)

- `apps/web/vercel.json`의 cron이 매일 `/api/cron/scheduled-scans`를 호출합니다.
- Vercel이 `CRON_SECRET`을 Authorization 헤더로 자동 전송하므로 환경변수만 설정하면 됩니다.
- 사용자가 대시보드에서 도메인별 "정기 검사 켜기"를 해야 대상이 됩니다.

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
