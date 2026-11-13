import { getTranslations } from "next-intl/server";
import { NotFoundContent } from "@/components/NotFoundContent";

/*
 * 페이지가 notFound()를 던질 때의 404 화면. 어느 라우트에도 맞지 않는 주소(오타 URL, 프록시가
 * 숨긴 관리자 경로)는 여기가 아니라 app/global-not-found.tsx가 그린다.
 *
 * 주의: [locale] 바로 아래에 loading.tsx를 두면 그 아래 페이지가 전부 Suspense 경계 안으로
 * 들어가 셸이 200으로 먼저 나가 버린다. 그러면 notFound()를 던져도 상태 코드가 안 바뀌고
 * 내용만 클라이언트에서 교체되는 soft 404가 된다. 스켈레톤은 느린 세그먼트에만 둘 것.
 */

// 이게 없으면 404 화면이 layout 기본값(홈 제목)을 그대로 단다. noindex는 Next가 404 응답에 직접 붙인다.
export async function generateMetadata() {
  const t = await getTranslations("errors");
  return { title: t("notFoundTitle"), description: t("notFoundDesc") };
}

export default function NotFoundPage() {
  return <NotFoundContent />;
}
