/**
 * 준수율 추이 미니 차트 — 서버 컴포넌트, 인라인 SVG (라이브러리 없음).
 * 색·글꼴은 테마 토큰만 사용. 스크린리더에는 요약 문장으로 전달.
 * target을 주면 목표선(대시 수평선)과 직전 검사 대비 변화 배지를 함께 표시한다.
 */
export interface TrendPoint {
  date: string; // ISO
  rate: number; // 0~100
}

export function TrendChart({
  points,
  label,
  locale,
  target,
}: {
  points: TrendPoint[];
  /** 접근성용 라벨 (예: "example.com 준수율 추이") */
  label: string;
  locale: string;
  /** 목표선 (예: 인증 합격선 95) — 미지정 시 표시 안 함 */
  target?: number;
}) {
  if (points.length < 2) return null;

  const W = 280;
  const H = 64;
  const PAD = { top: 8, right: 34, bottom: 14, left: 6 };
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;

  const rates = points.map((p) => p.rate);
  // 목표선이 있으면 y 도메인에 포함해 항상 화면 안에 그린다
  const domainValues = target != null ? [...rates, target] : rates;
  const min = Math.max(0, Math.floor(Math.min(...domainValues) - 5));
  const max = Math.min(100, Math.ceil(Math.max(...domainValues) + 5));
  const span = Math.max(1, max - min);

  const x = (i: number) => PAD.left + (iw * i) / (points.length - 1);
  const y = (r: number) => PAD.top + ih - (ih * (r - min)) / span;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.rate).toFixed(1)}`).join(" ");

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const prev = points[points.length - 2]!;
  const delta = Math.round((last.rate - first.rate) * 10) / 10;
  // 직전 검사 대비 변화 — 화살표+수치 병기 (색상 단독 전달 회피, WCAG 1.4.1)
  const deltaPrev = Math.round((last.rate - prev.rate) * 10) / 10;
  const en = locale === "en";
  const prevLabel = en ? "vs previous" : "직전 대비";
  const deltaBadge =
    deltaPrev > 0
      ? { arrow: "▲", text: `+${deltaPrev}%p`, color: "var(--color-seal)" }
      : deltaPrev < 0
        ? { arrow: "▼", text: `${deltaPrev}%p`, color: "var(--color-crit)" }
        : { arrow: "—", text: "±0%p", color: "var(--color-ink-faint)" };
  const dateFmt = new Intl.DateTimeFormat(en ? "en" : "ko", { month: "numeric", day: "numeric" });
  const srSummary = en
    ? `${label}: ${points.length} scans, ${first.rate}% → ${last.rate}% (${delta >= 0 ? "+" : ""}${delta}p), ${prevLabel} ${deltaPrev >= 0 ? "+" : ""}${deltaPrev}p${target != null ? `, target ${target}%` : ""}`
    : `${label}: 검사 ${points.length}회, ${first.rate}% → ${last.rate}% (${delta >= 0 ? "+" : ""}${delta}p), ${prevLabel} ${deltaPrev >= 0 ? "+" : ""}${deltaPrev}p${target != null ? `, 목표 ${target}%` : ""}`;

  return (
    <figure className="mt-1">
      <p aria-hidden="true" className="m-0 text-xs font-semibold" style={{ color: deltaBadge.color }}>
        {deltaBadge.arrow} {prevLabel} {deltaBadge.text}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={srSummary} className="max-w-full">
        {/* 기준선 (min/max) */}
        <line x1={PAD.left} y1={y(max)} x2={PAD.left + iw} y2={y(max)} stroke="var(--color-line)" strokeDasharray="3 3" strokeWidth="1" />
        <line x1={PAD.left} y1={y(min)} x2={PAD.left + iw} y2={y(min)} stroke="var(--color-line)" strokeDasharray="3 3" strokeWidth="1" />
        {/* 목표선 — 기준선과 다른 대시 패턴으로 구분 */}
        {target != null && (
          <>
            <line
              x1={PAD.left}
              y1={y(target)}
              x2={PAD.left + iw}
              y2={y(target)}
              stroke="var(--color-ink-faint)"
              strokeDasharray="6 3"
              strokeWidth="1"
            />
            <text
              x={PAD.left + iw + 4}
              y={y(target) + 3}
              fontSize="9"
              fill="var(--color-ink-faint)"
            >
              {target}%
            </text>
          </>
        )}
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
