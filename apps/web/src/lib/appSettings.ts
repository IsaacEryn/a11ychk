import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 요금제 시행 활성 여부. 기본 false(비활성) — 전원 free 등급으로 동작한다.
 * 관리자가 준비를 마친 뒤 관리자 페이지에서 활성화하면 배정된 요금제가 발효된다.
 */
export async function getPlansActive(db: SupabaseClient): Promise<boolean> {
  const { data } = await db.from("app_settings").select("value").eq("key", "plans").maybeSingle();
  const v = data?.value as { active?: boolean } | undefined;
  return v?.active === true;
}

export async function setPlansActive(admin: SupabaseClient, active: boolean): Promise<void> {
  await admin
    .from("app_settings")
    .upsert({ key: "plans", value: { active }, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

/**
 * 서비스 공지 — app_settings key "announcements"에 배열로 보관 (마이그레이션 불필요, 소량 전제).
 * 배너는 active인 최신 1건만 노출하고, /notices 페이지는 전체 이력을 보여준다.
 * (약관의 "서비스 내 공지" 조항을 구현하는 공식 채널)
 */
export interface Announcement {
  id: string;
  /** ISO 날짜 (표시용) */
  date: string;
  /** true면 사이트 배너에 노출 */
  active: boolean;
  /**
   * 배너 노출 종료 시각(ISO). 지나면 배너만 자동으로 내려가고 /notices 이력은 남는다.
   * 미지정이면 관리자가 직접 내릴 때까지 계속 노출.
   *
   * 시간이 지나 배너를 내리는 것은 "읽는 도중 사라지는" 시간 제한(WCAG 2.2.1)이 아니라
   * 게시 기간 종료다 — 페이지를 보고 있는 사용자에게서 콘텐츠를 뺏지 않는다.
   */
  expiresAt?: string;
  ko: { title: string; body: string };
  en: { title: string; body: string };
}

/** 배너 노출 대상인지 — active이고 만료되지 않았을 것 (순수 함수) */
export function isBannerActive(n: Announcement, now = Date.now()): boolean {
  if (!n.active) return false;
  if (!n.expiresAt) return true;
  const t = Date.parse(n.expiresAt);
  return Number.isNaN(t) ? true : t > now;
}

export async function getAnnouncements(db: SupabaseClient): Promise<Announcement[]> {
  const { data } = await db.from("app_settings").select("value").eq("key", "announcements").maybeSingle();
  const v = data?.value as { items?: Announcement[] } | undefined;
  return Array.isArray(v?.items) ? v.items : [];
}

export async function saveAnnouncements(admin: SupabaseClient, items: Announcement[]): Promise<void> {
  await admin
    .from("app_settings")
    .upsert({ key: "announcements", value: { items }, updated_at: new Date().toISOString() }, { onConflict: "key" });
}
