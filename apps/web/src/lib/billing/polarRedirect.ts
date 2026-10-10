/**
 * Polar가 호스팅하는 페이지(결제창·고객 포털)로 브라우저를 보내기 전의 검사 — 서버가 돌려준 주소라도 https이고 호스트가
 * polar.sh 또는 그 하위 도메인(sandbox.polar.sh·buy.polar.sh 등)일 때만 보낸다. 사용자 정보·포트가 붙은 주소는 거부한다.
 * 외부 이동은 서버 액션 redirect가 아니라 이 검사 뒤 window.location.assign으로 한다 — CSP form-action을 넓히지 않으려고.
 * 결제 확인 화면(MorCheckoutForm)과 결제 관리의 고객 포털 버튼이 함께 쓴다. 순수 함수라 서버에서도 같은 검사를 한다.
 */

const POLAR_HOST = "polar.sh";
/** 정상 주소보다 훨씬 긴 값은 받지 않는다 */
const URL_MAX = 2048;

export function isPolarHostedUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > URL_MAX) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return false;
  const host = url.hostname.toLowerCase();
  return host === POLAR_HOST || host.endsWith(`.${POLAR_HOST}`);
}

/** 허용 목록을 통과하면 그 주소로 이동하고 true, 아니면 이동하지 않고 false. assign은 테스트가 바꿔 끼운다 */
export function navigateToPolar(raw: unknown, assign: (url: string) => void = (url) => window.location.assign(url)): boolean {
  if (!isPolarHostedUrl(raw)) return false;
  assign(raw);
  return true;
}
