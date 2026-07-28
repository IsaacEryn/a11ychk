import { notFound } from "next/navigation";

/**
 * 로케일 하위 미매칭 경로 catch-all — notFound()를 던져 [locale]/not-found.tsx(헤더·테마 유지)를
 * 렌더한다. catch-all은 우선순위가 가장 낮아 실제 라우트를 가리지 않는다. 이게 없으면 로케일
 * 프리픽스 경로의 오타도 로케일 레이아웃 밖 루트 not-found로 떨어진다.
 *
 * 주의: [locale] 바로 아래에 loading.tsx를 두면 이 페이지가 Suspense 경계 안으로 들어가
 * 셸이 200으로 먼저 나가 버린다. 그러면 여기서 notFound()를 던져도 상태 코드가 안 바뀌고
 * 내용만 클라이언트에서 교체되는 soft 404가 된다. 스켈레톤은 느린 세그먼트에만 둘 것.
 */
export default function LocaleCatchAll(): never {
  notFound();
}
