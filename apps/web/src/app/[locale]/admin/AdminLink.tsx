import type { ComponentProps } from "react";
import { Link } from "@/i18n/navigation";

/**
 * 관리자 콘솔 전용 링크 — 프리페치를 끈 것 말고는 i18n Link와 같다.
 *
 * 관리자 페이지는 전부 동적 렌더(requireAdmin + Supabase 조회)라 프리페치해도
 * 캐시로 남지 않는다. 오히려 해롭다: 서버 액션이 revalidate하면 라우터 캐시가
 * 비워지며 화면에 보이는 모든 Link가 동시에 재프리페치되어, 무거운 admin RSC
 * 요청이 한꺼번에 몰린다. 사용자 목록(행마다 ?user= 쿼리가 달라 각각 별도 대상)
 * 에서 실측한 결과 폼 제출 1회에 RSC 요청 30여 건이 세 파동으로 발생했고 일부가
 * 503으로 떨어졌다. 그동안 폼은 "처리 중" 상태에 10초 넘게 묶여 있었다.
 *
 * 관리자 화면에서는 이 컴포넌트만 쓴다 — 개별 호출부에 prefetch={false}를
 * 흩어 두면 새 링크를 추가할 때 빠뜨리게 된다.
 */
export function AdminLink(props: ComponentProps<typeof Link>) {
  return <Link prefetch={false} {...props} />;
}
