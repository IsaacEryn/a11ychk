-- 보고서 우선 표준 설정 (null = 미설정 → locale 폴백: en=WCAG, ko=KWCAG)
-- Supabase SQL Editor에서 실행.

alter table public.profiles
  add column preferred_standard text
  check (preferred_standard is null or preferred_standard in ('wcag', 'kwcag'));

-- 컬럼 단위 grant는 누적 — 0001의 grant update (nickname, locale)는 유지된다
grant update (preferred_standard) on public.profiles to authenticated;
