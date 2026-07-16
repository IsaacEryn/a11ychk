-- 0012: 보고서 읽기 전용 공유 링크
-- 소유자가 켜고 끌 수 있는 무기한 공유 토큰. null = 비공개(기본).
alter table public.scans add column if not exists share_token text;

create unique index if not exists scans_share_token_idx
  on public.scans (share_token)
  where share_token is not null;
