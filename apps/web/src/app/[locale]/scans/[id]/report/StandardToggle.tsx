import { SegmentedQueryToggle } from "./SegmentedQueryToggle";

/** 표시 표준 토글 — 모두 / WCAG만 / KWCAG만. 어떤 보기에서도 다른 표준으로 즉시 전환 가능 */
export function StandardToggle({
  std,
  labels,
}: {
  std: "both" | "wcag" | "kwcag";
  labels: { legend: string; both: string; wcag: string; kwcag: string };
}) {
  return (
    <SegmentedQueryToggle
      param="std"
      value={std}
      defaultValue="both"
      legend={labels.legend}
      options={[
        { value: "both", label: labels.both },
        { value: "wcag", label: labels.wcag },
        { value: "kwcag", label: labels.kwcag },
      ]}
    />
  );
}
