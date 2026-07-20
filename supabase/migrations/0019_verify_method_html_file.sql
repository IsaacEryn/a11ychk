-- 도메인 소유 확인 방법에 HTML 파일(.well-known) 추가
-- Supabase SQL Editor에서 실행.

alter table public.domains drop constraint if exists domains_verify_method_check;
alter table public.domains
  add constraint domains_verify_method_check
  check (verify_method in ('dns_txt', 'meta_tag', 'html_file'));
