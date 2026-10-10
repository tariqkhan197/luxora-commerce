/**
 * Geometry for the small server-rendered bar charts used by the reports
 * (Phase 7). Pure: computes bar positions and a "nice" axis maximum.
 */

/** Smallest 1/2/5 × 10^n at or above `value` (0 stays 0). */
export function niceMax(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

export interface Bar {
  index: number;
  x: number;
  width: number;
  /** Top of the bar (SVG y grows downwards). */
  y: number;
  height: number;
  value: number;
}

/**
 * Lays out one bar per value in a `width` × `height` plot with `gap` between
 * bars. Negative values are drawn as zero-height (the reports' bar series are
 * never negative). A non-zero value is at least 1px tall so it stays visible.
 */
export function layoutBars(
  values: readonly number[],
  width: number,
  height: number,
  gap = 2,
): { bars: Bar[]; max: number } {
  const max = niceMax(Math.max(0, ...values));
  const count = values.length;
  if (count === 0) return { bars: [], max };
  const slot = width / count;
  const barWidth = Math.max(1, slot - Math.min(gap, slot / 2));
  const bars = values.map((value, index) => {
    const clamped = Math.max(0, value);
    const raw = max > 0 ? (clamped / max) * height : 0;
    const barHeight = clamped > 0 ? Math.max(1, raw) : 0;
    return { index, x: index * slot, width: barWidth, y: height - barHeight, height: barHeight, value };
  });
  return { bars, max };
}

/** Which x positions get a date label: first, last and a few evenly spaced in between. */
export function labelIndexes(count: number, maxLabels = 6): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (maxLabels - 1);
  return Array.from(new Set(Array.from({ length: maxLabels }, (_, i) => Math.round(i * step))));
}
