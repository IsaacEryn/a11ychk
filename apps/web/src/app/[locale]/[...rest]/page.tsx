import { notFound } from "next/navigation";

/**
 * 로케일 하위 미매칭 경로 catch-all — notFound()를 던져 [locale]/not-found.tsx(헤더·테마 유지)를
 * 렌더한다. catch-all은 우선순위가 가장 낮아 실제 라우트를 가리지 않는다. 이게 없으면 로케일
 * 프리픽스 경로의 오타도 로케일 레이아웃 밖 루트 not-found로 떨어진다.
 */
export default function LocaleCatchAll(): never {
  notFound();
}
