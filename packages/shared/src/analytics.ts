import type { AnalyticsDay } from "./types.js";

const DAY_MS = 86_400_000;
const MAX_ANALYTICS_DAYS = 400;

/** Missing metrics remain last in either sort direction. */
export function compareAnalyticsValues(
  left: number,
  right: number,
  descending = true,
): number {
  const leftValid = Number.isFinite(left);
  const rightValid = Number.isFinite(right);
  if (!leftValid || !rightValid) return leftValid ? -1 : rightValid ? 1 : 0;
  return descending ? right - left : left - right;
}

function parseIsoDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.NaN;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : Number.NaN;
}

/** Always include zero, including series made entirely of subscriber losses. */
export function analyticsChartDomain(values: number[]): { min: number; max: number } {
  const finite = values.filter(Number.isFinite);
  const min = Math.min(0, ...finite);
  const max = Math.max(0, ...finite);
  return { min, max: max === min ? min + 1 : max };
}

function emptyAnalyticsDay(date: string): AnalyticsDay {
  return {
    date,
    views: 0,
    engagedViews: 0,
    estimatedMinutesWatched: 0,
    averageViewDuration: 0,
    averageViewPercentage: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    subscribersGained: 0,
    subscribersLost: 0,
  };
}

/**
 * YouTube Analytics omits rows for calendar days without activity. Filling
 * those gaps is required before rolling seven-day comparisons and sparklines;
 * otherwise "last 7 days" can silently cover a longer and unequal period.
 */
export function fillAnalyticsDays(
  rows: AnalyticsDay[],
  startDate: string,
  endDate: string,
): AnalyticsDay[] {
  const start = parseIsoDate(startDate);
  const requestedEnd = parseIsoDate(endDate);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(requestedEnd) ||
    requestedEnd < start
  ) {
    return [];
  }
  const validRows = rows.filter((row) => {
    const timestamp = parseIsoDate(row.date);
    return (
      Number.isFinite(timestamp) && timestamp >= start && timestamp <= requestedEnd
    );
  });
  if (validRows.length === 0) return [];

  // Analytics processing can lag behind the requested end date. Do not turn
  // unavailable trailing dates into zero-view days, because that creates a
  // false decline. We only fill internal gaps up to the latest returned day.
  const end = Math.max(...validRows.map((row) => parseIsoDate(row.date)));
  const requestedDays = Math.floor((end - start) / DAY_MS) + 1;
  if (requestedDays > MAX_ANALYTICS_DAYS) return [];

  const byDate = new Map(validRows.map((row) => [row.date, row]));
  return Array.from({ length: requestedDays }, (_, index) => {
    const date = new Date(start + index * DAY_MS).toISOString().slice(0, 10);
    return byDate.get(date) ?? emptyAnalyticsDay(date);
  });
}

/** Rounded change in percent; 100 when growing from nothing, 0 when flat at zero. */
export function percentChange(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
