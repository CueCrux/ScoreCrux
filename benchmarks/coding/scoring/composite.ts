/**
 * Composite scoring — combines C1, C2, C3 with fixed weights.
 */

import type { C1Score, C2Score, C3Score } from "../lib/types.js";

export const WEIGHTS = {
  C1: 0.45,
  C2: 0.35,
  C3: 0.20,
} as const;

export function computeComposite(c1: C1Score, c2: C2Score, c3: C3Score): number {
  return WEIGHTS.C1 * c1.score + WEIGHTS.C2 * c2.score + WEIGHTS.C3 * c3.score;
}
