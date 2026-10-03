import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KwcagNo } from "@/components/KwcagNo";

describe("KwcagNo", () => {
  it("화면에는 일련번호만, 스크린 리더에는 「검사항목 8」로 읽히고 뒤따르는 이름과 띄어진다", () => {
    const html = renderToStaticMarkup(createElement(KwcagNo, { serial: 8, locale: "ko" }));
    expect(html).toBe(
      '<span class="mr-2 tabular-nums text-[var(--color-ink-faint)]">' +
        '<span class="sr-only">검사항목 </span>8<span class="sr-only"> </span></span>',
    );
  });

  it("영어는 Checkpoint, className은 덮어쓸 수 있다", () => {
    const html = renderToStaticMarkup(createElement(KwcagNo, { serial: 29, locale: "en", className: "mr-1.5 tabular-nums" }));
    expect(html).toBe(
      '<span class="mr-1.5 tabular-nums"><span class="sr-only">Checkpoint </span>29<span class="sr-only"> </span></span>',
    );
  });
});
