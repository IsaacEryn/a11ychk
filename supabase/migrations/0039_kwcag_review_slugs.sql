-- ═══════════════════════════════════════════════════════════════
-- KWCAG 판정 키를 옛 번호에서 슬러그로 (scan_reviews, standard='kwcag')
-- 실행: Supabase Dashboard → SQL Editor. 웹 배포가 안정된 뒤 실행한다 — 새 코드는 옛 번호 행도
-- 바르게 읽으므로 서두를 필요가 없고, 그 전까지는 롤백 여지가 남는다. 여러 번 실행해도 결과가 같다.
--
-- 2026-10 이전 a11ychk는 KWCAG 항목을 자체 번호로 저장했다. 그중 10개가 KS X OT0003:2022 공식
-- 번호와 달랐고 6개는 공식 체계에서 다른 항목의 번호라, 숫자로는 어느 항목인지 가릴 수 없다.
-- 바뀌지 않는 슬러그로 저장해 번호가 바뀌어도 판정이 다른 항목으로 읽히지 않게 한다.
-- 대응표는 packages/core/src/catalog/kwcagLegacy.ts의 KWCAG_LEGACY_IDS와 같아야 한다
-- (apps/web/tests/kwcagReviewSlugsSql.test.ts가 확인).
-- ═══════════════════════════════════════════════════════════════
begin;

create temporary table kwcag_legacy_ids (old_id text primary key, slug text not null) on commit drop;
insert into kwcag_legacy_ids (old_id, slug) values
  ('5.1.1', 'alternative-text'),
  ('5.2.1', 'captions-for-multimedia'),
  ('5.3.1', 'content-not-relying-on-color-alone'),
  ('5.3.2', 'clear-instructions'),
  ('5.4.1', 'text-contrast'),
  ('5.4.2', 'no-auto-play'),
  ('5.4.3', 'distinguishable-content'),
  ('6.1.1', 'keyboard-accessible'),
  ('6.1.2', 'focus-order-and-visibility'),
  ('6.1.3', 'target-size'),
  ('6.1.4', 'character-key-shortcuts'),
  ('6.2.1', 'adjustable-time-limits'),
  ('6.2.2', 'pause-stop-hide'),
  ('6.3.1', 'no-flashing-content'),
  ('6.4.1', 'skip-repeated-blocks'),
  ('6.4.2', 'page-frame-and-content-titles'),
  ('6.4.3', 'meaningful-link-text'),
  ('6.4.4', 'consistent-reference-locators'),
  ('6.5.1', 'single-pointer-gestures'),
  ('6.5.2', 'pointer-cancellation'),
  ('6.5.3', 'label-in-name'),
  ('6.5.4', 'motion-actuation'),
  ('7.1.1', 'language-of-page'),
  ('7.2.1', 'no-change-of-context-without-request'),
  ('7.2.2', 'consistent-help'),
  ('7.3.1', 'meaningful-sequence'),
  ('7.3.2', 'table-structure'),
  ('7.4.1', 'labels-for-inputs'),
  ('7.4.2', 'error-identification'),
  ('7.4.3', 'accessible-authentication'),
  ('7.4.4', 'redundant-entry'),
  ('8.1.1', 'valid-markup'),
  ('8.2.1', 'aria-accessibility');

-- 배포 뒤 같은 항목을 다시 판정해 슬러그 행이 이미 있으면 그쪽이 더 새 판정이다 — 옛 행을 지운다
delete from public.scan_reviews r
using kwcag_legacy_ids l
where r.standard = 'kwcag'
  and r.item_id = l.old_id
  and exists (
    select 1 from public.scan_reviews s
    where s.scan_id = r.scan_id and s.standard = 'kwcag' and s.item_id = l.slug
  );

-- 남은 옛 번호 행을 슬러그로. 숫자와 슬러그는 겹치지 않으므로 unique (scan_id, standard, item_id)와 충돌하지 않는다
update public.scan_reviews r
set item_id = l.slug
from kwcag_legacy_ids l
where r.standard = 'kwcag' and r.item_id = l.old_id;

commit;
