/** Median of a non-empty list (the mean of the two middle values for an even count). */
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** Median + range of a sample, or null when there is none (never a zero that reads as "instant"). */
export function summarize(
  xs: number[]
): { median: number; min: number; max: number; n: number } | null {
  if (!xs.length) return null;
  return { median: median(xs), min: Math.min(...xs), max: Math.max(...xs), n: xs.length };
}
