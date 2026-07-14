/**
 * 카탈로그 가이드(경량 마크다운) 렌더러.
 * 지원: ``` 코드 블록, `인라인 코드`, **굵게**, 문단.
 * React 텍스트 노드로만 출력하므로 XSS 안전.
 */
import { Fragment } from "react";

function renderInline(text: string, keyPrefix: string) {
  // `code` 와 **bold** 토큰 분리
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={`${keyPrefix}-${i}`} className="rounded bg-[var(--color-paper-warm)] px-1 py-0.5 text-[0.88em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>;
  });
}

export function GuideText({ text }: { text: string }) {
  const blocks = text.split(/```(?:\w*)\n?/);
  return (
    <div className="space-y-3 text-[0.95rem] leading-relaxed">
      {blocks.map((block, i) =>
        i % 2 === 1 ? (
          // 홀수 인덱스 = 코드 블록
          <pre
            key={i}
            tabIndex={0}
            className="overflow-x-auto rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)] p-3 text-[0.85rem] leading-normal"
          >
            <code>{block.trimEnd()}</code>
          </pre>
        ) : (
          block
            .split(/\n{2,}/)
            .filter((p) => p.trim())
            .map((para, j) => <p key={`${i}-${j}`}>{renderInline(para.trim(), `${i}-${j}`)}</p>)
        ),
      )}
    </div>
  );
}
