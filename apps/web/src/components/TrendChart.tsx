/**
 * 준수율 추이 미니 차트 — 서버 컴포넌트, 인라인 SVG (라이브러리 없음).
 * 색·글꼴은 테마 토큰만 사용. 스크린리더에는 요약 문장으로 전달.
 */
export interface TrendPoint {
  date: string; // ISO
  rate: number; // 0~100
}

export function TrendChart({
  points,
  label,
  locale,
}: {
  points: TrendPoint[];
  /** 접근성용 라벨 (예: "example.com 준수율 추이") */
  label: string;
  locale: string;
}) {
  if (points.length < 2) return null;

  const W = 280;
  const H = 64;
  const PAD = { top: 8, right: 34, bottom: 14, left: 6 };
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;

  const rates = points.map((p) => p.rate);
  const min = Math.max(0, Math.floor(Math.min(...rates) - 5));
  const max = Math.min(100, Math.ceil(Math.max(...rates) + 5));
  const span = Math.max(1, max - min);

  const x = (i: number) => PAD.left + (iw * i) / (points.length - 1);
  const y = (r: number) => PAD.top + ih - (ih * (r - min)) / span;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.rate).toFixed(1)}`).join(" ");

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const delta = Math.round((last.rate - first.rate) * 10) / 10;
  const dateFmt = new Intl.DateTimeFormat(locale === "en" ? "en" : "ko", { month: "numeric", day: "numeric" });
  const srSummary =
    locale === "en"
      ? `${label}: ${points.length} scans, ${first.rate}% → ${last.rate}% (${delta >= 0 ? "+" : ""}${delta}p)`
      : `${label}: 검사 ${points.length}회, ${first.rate}% → ${last.rate}% (${delta >= 0 ? "+" : ""}${delta}p)`;

  return (
    <figure className="mt-1">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={srSummary} className="max-w-full">
        {/* 기준선 (min/max) */}
        <line x1={PAD.left} y1={y(max)} x2={PAD.left + iw} y2={y(max)} stroke="var(--color-line)" strokeDasharray="3 3" strokeWidth="1" />
        <line x1={PAD.left} y1={y(min)} x2={PAD.left + iw} y2={y(min)} stroke="var(--color-line)" strokeDasharray="3 3" strokeWidth="1" />
        {/* 추이선 */}
        <path d={path} fill="none" stroke="var(--color-seal)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* 점 */}
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.rate)} r={i === points.length - 1 ? 3.5 : 2} fill="var(--color-seal)" />
        ))}
        {/* 최신 값 라벨 */}
        <text
          x={x(points.length - 1) + 6}
          y={y(last.rate) + 4}
          fontSize="12"
          fontWeight="700"
          fill="var(--color-seal)"
        >
          {last.rate}%
        </text>
        {/* 시작·끝 날짜 */}
        <text x={PAD.left} y={H - 2} fontSize="9" fill="var(--color-ink-faint)">
          {dateFmt.format(new Date(first.date))}
        </text>
        <text x={PAD.left + iw} y={H - 2} fontSize="9" textAnchor="end" fill="var(--color-ink-faint)">
          {dateFmt.format(new Date(last.date))}
        </text>
      </svg>
      <figcaption className="sr-only">{srSummary}</figcaption>
    </figure>
  );
}
