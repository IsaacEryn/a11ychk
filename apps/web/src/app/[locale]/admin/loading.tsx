import { RouteSkeleton } from "@/components/RouteSkeleton";

// DB를 여러 번 오가는 구간이라 전환 중 흰 화면이 길다.
// 공개 페이지에는 걸지 않는다 — 이유는 RouteSkeleton 주석 참고.
export default function Loading() {
  return <RouteSkeleton />;
}
