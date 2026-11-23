/**
 * Tiny 14-day trend (design v2): a dot-matrix column per day, or thin bars. Purely visual summary of real data;
 * the numbers are also in the accessible label.
 */
export function MiniChart({ values, color, variant = "dots", label }: { values: number[]; color: string; variant?: "dots" | "bars"; label: string }) {
  const max = Math.max(1, ...values);
  const rows = 6;
  const w = 128;
  const h = 30;
  const step = w / values.length;
  return (
    <svg role="img" aria-label={`${label}: ${values.join(", ")} (last 14 days)`} viewBox={`0 0 ${w} ${h}`} className="h-[30px] w-full max-w-[160px]" preserveAspectRatio="none">
      {values.map((v, i) => {
        const x = i * step + step / 2;
        if (variant === "bars") {
          const bh = v === 0 ? 2 : Math.max(4, (v / max) * h);
          return <rect key={i} x={x - 1.6} y={h - bh} width={3.2} height={bh} rx={1.2} fill={v === 0 ? "var(--chart-empty)" : color} />;
        }
        const filled = v === 0 ? 0 : Math.max(1, Math.round((v / max) * rows));
        return Array.from({ length: rows }, (_, r) => (
          <circle key={`${i}-${r}`} cx={x} cy={h - 2.5 - r * 5} r={1.5} fill={r < filled ? color : "var(--chart-empty)"} />
        ));
      })}
    </svg>
  );
}
