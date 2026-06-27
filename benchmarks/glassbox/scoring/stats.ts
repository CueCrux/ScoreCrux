// GlassBox — Wilson score confidence interval for a binomial proportion.
// Used to report every rate as point ± 95% CI, so small-n results aren't
// over-read. (n=0 -> [0,1]; the interval narrows as n grows.)

export interface Rate {
  k: number; // successes
  n: number; // trials
  p: number; // point estimate
  lo: number; // 95% CI lower
  hi: number; // 95% CI upper
}

export function wilson(k: number, n: number, z = 1.96): Rate {
  if (n <= 0) return { k, n, p: 0, lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return {
    k, n, p,
    lo: Math.max(0, Number((center - margin).toFixed(4))),
    hi: Math.min(1, Number((center + margin).toFixed(4))),
  };
}

/** Compact "pp% [lo–hi]" for display. */
export function fmtRate(r: Rate): string {
  return `${(r.p * 100).toFixed(0)}% [${(r.lo * 100).toFixed(0)}–${(r.hi * 100).toFixed(0)}], n=${r.n}`;
}
