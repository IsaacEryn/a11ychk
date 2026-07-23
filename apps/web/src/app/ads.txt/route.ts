// ads.txt — 게시자 ID(ADSENSE_ACCOUNT)를 환경변수로 서빙한다.
// 정적 public/ads.txt를 repo에 두면 포크 배포에도 우리 게시자 ID가 그대로 노출되어,
// 무효 트래픽·정책 위반이 우리 계정에 귀속될 수 있다. env 미설정(포크 등)이면 404.
export const dynamic = "force-static";

export function GET(): Response {
  const account = process.env.ADSENSE_ACCOUNT?.trim();
  if (!account) {
    return new Response("Not found", { status: 404 });
  }
  // 형식: google.com, pub-XXXX, DIRECT, f08c47fec0942fa0 (AdSense 고정 인증 ID)
  const body = `google.com, ${account}, DIRECT, f08c47fec0942fa0\n`;
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
