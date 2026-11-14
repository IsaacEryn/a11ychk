import { AUTH_COOKIE } from "./authCookie";

/**
 * 레이아웃이 nonce 없이 싣는 인라인 스크립트 — 내용이 빌드 내내 고정이라 해시로 허용한다.
 *
 * 동적 페이지는 프록시(lib/security/csp.ts)가 이 문자열의 sha256을 헤더 정책에 넣고, 정적 페이지는 빌드
 * 어댑터가 HTML에서 직접 해시한다. 글자 하나만 바뀌어도 해시가 달라지지만 두 경로 모두 이 문자열에서
 * 계산하므로 따로 맞출 값은 없다(test:routes가 응답의 인라인 스크립트가 전부 허용되는지 확인한다).
 */

export const THEME_STORAGE_KEY = "a11ychk-theme";

/**
 * 첫 페인트 전에 <html>에 두 속성을 단다.
 *
 * - data-theme: 저장된 테마(깜빡임 방지)
 * - data-auth: 인증 쿠키가 있으면 "in" — 정적 HTML은 로그인·비로그인 화면을 함께 담고, globals.css의
 *   .auth-in/.auth-out 규칙이 이 값으로 한쪽만 보인다. 쿠키 유무만 보는 화면 힌트이고 권한 판단이 아니다
 *   (보호 페이지·API는 서버가 세션을 검증한다). 이후 변화는 AuthSync가 따라간다.
 */
export const bootScript = `(function(){var d=document.documentElement;try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark'||t==='contrast'){d.setAttribute('data-theme',t);}}catch(e){}d.setAttribute('data-auth',${AUTH_COOKIE.toString()}.test(document.cookie)?'in':'out');})();`;

/** GTM 컨테이너 ID — 형식이 맞을 때만 쓴다(스크립트 문자열에 그대로 들어간다) */
export function gtmContainerId(): string | null {
  const id = process.env.NEXT_PUBLIC_GTM_ID?.trim();
  return id && /^GTM-[A-Z0-9]+$/.test(id) ? id : null;
}

/** GTM 공식 부트스트랩 — gtm.js를 비동기로 붙인다 */
export function gtmBootstrapScript(id: string): string {
  return `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');`;
}

/** 레이아웃이 싣는 인라인 스크립트 전부 — 동적 페이지 정책의 해시 목록 */
export function layoutInlineScripts(): string[] {
  const gtm = gtmContainerId();
  return gtm ? [bootScript, gtmBootstrapScript(gtm)] : [bootScript];
}
