import { labelIndexes, layoutBars } from "@/lib/reporting/chart";

interface BarChartProps {
  title: string;
  /** One point per UTC day (or category), in display order. */
  points: { label: string; value: number }[];
  format: (value: number) => string;
  /** Accessible description of what the bars measure. */
  description: string;
}

const WIDTH = 720;
const HEIGHT = 160;
const AXIS = 22;

/**
 * Single-series bar chart rendered on the server as SVG (no chart library).
 * Each bar has a native hover title; the same numbers are available as a table.
 */
export function BarChart({ title, points, format, description }: BarChartProps) {
  const { bars, max } = layoutBars(
    points.map((point) => point.value),
    WIDTH,
    HEIGHT,
  );
  const labels = new Set(labelIndexes(points.length));
  const empty = points.every((point) => point.value === 0);

  return (
    <figure className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="text-xs text-ink-faint">Scale up to {format(max)}</span>
      </figcaption>
      {empty ? (
        <p className="py-10 text-center text-sm text-ink-soft">Nothing in this period.</p>
      ) : (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT + AXIS}`}
          className="h-auto w-full"
          role="img"
          aria-label={`${title}: ${description}`}
        >
          <line x1={0} x2={WIDTH} y1={HEIGHT} y2={HEIGHT} className="stroke-line" strokeWidth={1} />
          {bars.map((bar) => (
            <g key={bar.index}>
              <rect
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                rx={Math.min(4, bar.width / 2)}
                className="fill-ink"
              />
              {/* Full-height hit target so small bars are easy to hover. */}
              <rect x={bar.x} y={0} width={bar.width} height={HEIGHT} fill="transparent">
                <title>{`${points[bar.index].label}: ${format(bar.value)}`}</title>
              </rect>
              {labels.has(bar.index) ? (
                <text
                  x={bar.x + bar.width / 2}
                  y={HEIGHT + 15}
                  textAnchor="middle"
                  className="fill-ink-faint text-[11px]"
                >
                  {points[bar.index].label}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      )}
      <details className="text-xs text-ink-soft">
        <summary className="cursor-pointer">Show as table</summary>
        <table className="mt-2 w-full">
          <tbody className="divide-y divide-line">
            {points.map((point, index) => (
              <tr key={index}>
                <td className="py-1">{point.label}</td>
                <td className="py-1 text-right tabular-nums">{format(point.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
