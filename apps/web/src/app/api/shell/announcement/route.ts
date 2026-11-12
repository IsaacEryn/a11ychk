import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAnnouncements, isBannerActive } from "@/lib/appSettings";

/**
 * 노출 중인 서비스 공지 1건 — 전 페이지 상단 배너(AnnouncementSlot)가 읽는다.
 *
 * 예전에는 레이아웃이 요청마다 DB를 읽었는데, 그러면 모든 페이지가 요청마다 렌더된다. 배너는 클라이언트가
 * 이 주소에서 받아 그리고, 이 응답은 60초 단위로 다시 만든다(ISR) — 방문자가 아무리 많아도 DB 조회는
 * 1분에 한 번꼴이다. 관리자가 공지를 올리거나 내리면 revalidatePath로 바로 갱신한다(lib/actions/admin.ts).
 *
 * 배너에 필요한 것(id·제목·만료 시각)만 낸다. 본문은 /notices에서 읽는다.
 */
export const revalidate = 60;

export interface ShellNotice {
  id: string;
  expiresAt?: string;
  ko: { title: string };
  en: { title: string };
}

async function activeNotice(): Promise<ShellNotice | null> {
  try {
    const n = (await getAnnouncements(createAdminClient())).find((item) => isBannerActive(item));
    if (!n) return null;
    return {
      id: n.id,
      ...(n.expiresAt ? { expiresAt: n.expiresAt } : {}),
      ko: { title: n.ko.title },
      en: { title: n.en.title },
    };
  } catch {
    // 설정 누락(빌드 환경)·DB 장애 — 배너를 띄우지 않는다
    return null;
  }
}

export async function GET() {
  return NextResponse.json({ notice: await activeNotice() });
}
