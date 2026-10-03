import { KWCAG_NO_PREFIX } from "@a11ychk/core/catalog";

/**
 * KWCAG 번호 앞머리 — 화면에는 인증 심사 일련번호만 보이고, 스크린 리더에는 「검사항목 8」로 읽힌다.
 * 표·목록에서 항목 이름 앞에 둔다. 문장 속 표기는 core의 kwcagLabel을 쓴다.
 * 번호 뒤의 스크린 리더 전용 공백은 뒤따르는 이름과 붙어 「검사항목 8텍스트 …」로 읽히지 않게 한다.
 */
export function KwcagNo({
  serial,
  locale,
  className = "mr-2 tabular-nums text-[var(--color-ink-faint)]",
}: {
  serial: number;
  locale: string;
  className?: string;
}) {
  return (
    <span className={className}>
      <span className="sr-only">{locale === "en" ? KWCAG_NO_PREFIX.en : KWCAG_NO_PREFIX.ko} </span>
      {serial}
      <span className="sr-only"> </span>
    </span>
  );
}
