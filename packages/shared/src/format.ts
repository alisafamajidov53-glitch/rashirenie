/** Exact localized values; unlike compact counters, averages keep fractions. */
export function formatExactMetric(value: number, locale = "ru-RU", digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  const precision = Number.isFinite(digits)
    ? Math.min(10, Math.max(0, Math.trunc(digits)))
    : 0;
  return value.toLocaleString(locale, { maximumFractionDigits: precision });
}

export function formatMetric(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const absolute = Math.abs(safe);
  if (absolute < 10_000) {
    return Math.round(safe)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
  const compact = (divisor: number, suffix: string) => {
    const amount = safe / divisor;
    const decimals = Math.abs(amount) < 100 ? 1 : 0;
    return `${amount.toFixed(decimals).replace(/\.0$/, "")}${suffix}`;
  };
  if (absolute < 1_000_000) return compact(1_000, "K");
  if (absolute < 1_000_000_000) return compact(1_000_000, "M");
  return compact(1_000_000_000, "B");
}

/**
 * A net change with an explicit sign: "+12", "−3", "0".
 *
 * The minus is U+2212, not a hyphen. Call sites used to prepend "+" only for
 * non-negative values and let `formatMetric` print its own ASCII hyphen, so a
 * loss read "-28" in one card and "−28" in the next.
 */
export function formatSignedMetric(value: number): string {
  if (!Number.isFinite(value) || Math.round(value) === 0) return "0";
  return `${value > 0 ? "+" : "−"}${formatMetric(Math.abs(value))}`;
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(digits).replace(/\.0$/, "")}%`;
}

/** Keep user-controlled CSV text from being interpreted as a spreadsheet formula. */
export function protectSpreadsheetCell(value: string): string {
  return /^[\s\u0000-\u001f]*[=+\-@＝＋－＠]/u.test(value) ||
    /^[\t\r\n\u0000]/u.test(value)
    ? `\t${value}`
    : value;
}
