/**
 * 화면·메일에 링크로 싣는 결제 주소의 스킴 검사 — http(s)만 통과시킨다(javascript:·data: 등은 null).
 * 결제사가 준 값(영수증 주소)뿐 아니라 호출부가 만든 주소도 한 번 더 거른다. 주소를 서버에서 열지는 않는다.
 */
export function httpUrl(u: string | null | undefined): string | null {
  return u && /^https?:\/\//i.test(u) ? u : null;
}
