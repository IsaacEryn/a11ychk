import { SegmentedQueryToggle } from "./SegmentedQueryToggle";

/** 보고서 출력 범위 토글 — 전체 / 자동 검사만 / 판정 완료만 / 오류만 */
export function ViewToggle({
  view,
  labels,
}: {
  view: "all" | "auto" | "done" | "issues";
  labels: { legend: string; all: string; auto: string; done: string; issues: string };
}) {
  return (
    <SegmentedQueryToggle
      param="view"
      value={view}
      defaultValue="all"
      legend={labels.legend}
      options={[
        { value: "all", label: labels.all },
        { value: "auto", label: labels.auto },
        { value: "done", label: labels.done },
        { value: "issues", label: labels.issues },
      ]}
    />
  );
}
