# 운영 환경 설정 가이드

## 1. Supabase 프로젝트

1. [supabase.com](https://supabase.com/dashboard)에서 새 프로젝트 생성 (리전: Northeast Asia 권장)
2. **SQL Editor**에서 `supabase/migrations/0001_initial_schema.sql` 실행
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
NEXT_PUBLIC_SITE_URL=https://a11ychk.com
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
