export interface SparklinePoint {
  x: number;
  y: number;
}

/**
 * Averages a long series into at most `maxPoints` equal buckets.
 *
 * 24 hours of 5-minute samples is 288 points: drawn raw across a 340px card
 * that is a band of noise, not a trend.
 */
export function bucketAverage(values: number[], maxPoints: number): number[] {
  const finite = values.map((value) => (Number.isFinite(value) ? value : 0));
  if (maxPoints < 2 || finite.length <= maxPoints) return finite;
  const size = finite.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, bucket) => {
    const start = Math.floor(bucket * size);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * size));
    const slice = finite.slice(start, end);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

export interface TrendPath {
  /** Smoothed stroke, as an SVG path `d`. */
  line: string;
  /** The same curve closed down to the baseline, for the area fill. */
  area: string;
  /** Position of the latest sample, for the "now" marker. */
  last: SparklinePoint;
}

/**
 * A smoothed trend line on a zero baseline, in a `width`×`height` box.
 *
 * The scale starts at 0: this draws rates (views per minute), where a min–max
 * scale turned a dip from 14 to 11 views/min into a crash to the floor. Segments are Catmull-Rom splines converted to cubic
 * Béziers, with control points clamped to the box so the curve never
 * overshoots below zero or above the top.
 */
export function smoothTrendPath(values: number[], width = 300, height = 64): TrendPath {
  const series = values.length >= 2 ? values : [values[0] ?? 0, values[0] ?? 0];
  const finite = series.map((value) =>
    Number.isFinite(value) ? Math.max(0, value) : 0,
  );
  const max = Math.max(...finite);
  const top = 4;
  const bottom = height - 2;
  const lastIndex = finite.length - 1;
  const points = finite.map((value, index) => ({
    x: (index / lastIndex) * width,
    // A flat series sits in the middle rather than on the floor, where it
    // would read as "zero".
    y: max > 0 ? bottom - (value / max) * (bottom - top) : (top + bottom) / 2,
  }));
  const clampY = (y: number) => Math.min(bottom, Math.max(top, y));
  const format = (value: number) => value.toFixed(1);
  let line = `M${format(points[0]!.x)},${format(points[0]!.y)}`;
  for (let index = 0; index < lastIndex; index += 1) {
    const previous = points[Math.max(0, index - 1)]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const after = points[Math.min(lastIndex, index + 2)]!;
    const c1x = current.x + (next.x - previous.x) / 6;
    const c1y = clampY(current.y + (next.y - previous.y) / 6);
    const c2x = next.x - (after.x - current.x) / 6;
    const c2y = clampY(next.y - (after.y - current.y) / 6);
    line += ` C${format(c1x)},${format(c1y)} ${format(c2x)},${format(c2y)} ${format(next.x)},${format(next.y)}`;
  }
  return {
    line,
    area: `${line} L${format(width)},${format(height)} L0,${format(height)} Z`,
    last: points[lastIndex]!,
  };
}
