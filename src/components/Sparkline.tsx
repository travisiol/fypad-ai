/** A tiny SVG line from real market-cap snapshots. Fewer than two points: a flat dashed line (no data, no guess). */
export function Sparkline({ points, width = 64, height = 28, stroke = "currentColor", strokeWidth = 2 }: { points: number[]; width?: number; height?: number; stroke?: string; strokeWidth?: number }) {
  if (points.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <line x1="2" y1={height / 2} x2={width - 2} y2={height / 2} stroke={stroke} strokeWidth={1.5} strokeDasharray="3 4" opacity={0.5} />
      </svg>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${(2 + (i / (points.length - 1)) * (width - 4)).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
