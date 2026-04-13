/**
 * Cross-floor progression analysis and leaderboard formatting.
 */

import type { FloorScore, AggregateScore } from "./floor-rubric.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProgressionAnalysis {
  /** Score progression across floors */
  scoreProgression: Array<{ floor: number; score: number }>;
  /** Per-act aggregated performance */
  actPerformance: Array<{
    act: number;
    floors: number;
    avgCompletion: number;
    avgPrecision: number;
    avgRecall: number;
    floorsCleared: number;
  }>;
  /** Floor where agent performance drops significantly */
  difficultyCliff: number | null;
  /** Measured impact of memory wipes on performance */
  wipeImpact: {
    preWipeAvg: number;
    postWipeAvg: number;
    degradation: number;
  } | null;
}

export interface LeaderboardEntry {
  rank: number;
  model: string;
  arm: string;
  floorsCleared: number;
  highestFloor: number;
  cumulativeScore: number;
  efficiency: number;
  resilience: number;
  cruxComposite: number;
}

// ---------------------------------------------------------------------------
// Progression analysis
// ---------------------------------------------------------------------------

function floorToAct(floor: number): number {
  if (floor <= 10) return 1;
  if (floor <= 25) return 2;
  if (floor <= 50) return 3;
  if (floor <= 75) return 4;
  return 5;
}

/**
 * Analyse performance progression across floors.
 */
export function analyseProgression(floorScores: FloorScore[]): ProgressionAnalysis {
  const sorted = [...floorScores].sort((a, b) => a.floor - b.floor);

  // Score progression
  const scoreProgression = sorted.map((s) => ({
    floor: s.floor,
    score: s.objectiveCompletion,
  }));

  // Per-act performance
  const actMap = new Map<number, FloorScore[]>();
  for (const s of sorted) {
    const act = floorToAct(s.floor);
    if (!actMap.has(act)) actMap.set(act, []);
    actMap.get(act)!.push(s);
  }

  const actPerformance = [...actMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([act, scores]) => ({
      act,
      floors: scores.length,
      avgCompletion: scores.reduce((s, f) => s + f.objectiveCompletion, 0) / scores.length,
      avgPrecision: scores.reduce((s, f) => s + f.evidencePrecision, 0) / scores.length,
      avgRecall: scores.reduce((s, f) => s + f.evidenceRecall, 0) / scores.length,
      floorsCleared: scores.filter((f) => f.elevatorKey).length,
    }));

  // Difficulty cliff: find first floor where completion drops > 40% vs. previous
  let difficultyCliff: number | null = null;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    if (prev.objectiveCompletion > 0.3 && curr.objectiveCompletion < prev.objectiveCompletion * 0.6) {
      difficultyCliff = curr.floor;
      break;
    }
  }

  // Memory wipe impact
  let wipeImpact: ProgressionAnalysis["wipeImpact"] = null;
  const wipeFloors = sorted.filter((s) => s.memoryRecoveryRate !== null);
  if (wipeFloors.length > 0) {
    // Compare performance on floors before and after wipes
    const wipeFloorNums = new Set(wipeFloors.map((s) => s.floor));
    const preWipe = sorted.filter((s) => {
      for (const wf of wipeFloorNums) {
        if (s.floor === wf - 1) return true;
      }
      return false;
    });
    const postWipe = sorted.filter((s) => wipeFloorNums.has(s.floor));

    const preWipeAvg =
      preWipe.length > 0
        ? preWipe.reduce((s, f) => s + f.objectiveCompletion, 0) / preWipe.length
        : 0;
    const postWipeAvg =
      postWipe.length > 0
        ? postWipe.reduce((s, f) => s + f.objectiveCompletion, 0) / postWipe.length
        : 0;

    wipeImpact = {
      preWipeAvg,
      postWipeAvg,
      degradation: preWipeAvg > 0 ? 1 - postWipeAvg / preWipeAvg : 0,
    };
  }

  return { scoreProgression, actPerformance, difficultyCliff, wipeImpact };
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

/**
 * Build a leaderboard from multiple run results.
 */
export function buildLeaderboard(
  runs: Array<{
    model: string;
    arm: string;
    floorScores: FloorScore[];
    aggregate: AggregateScore;
    cruxComposite: number;
  }>,
): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = runs
    .map((r) => ({
      rank: 0,
      model: r.model,
      arm: r.arm,
      floorsCleared: r.aggregate.floorsCleared,
      highestFloor: r.aggregate.highestFloor,
      cumulativeScore: r.aggregate.cumulativeScore,
      efficiency: r.aggregate.efficiency,
      resilience: r.aggregate.resilience,
      cruxComposite: r.cruxComposite,
    }))
    .sort((a, b) => {
      // Primary: highest floor cleared
      if (b.highestFloor !== a.highestFloor) return b.highestFloor - a.highestFloor;
      // Tiebreak: cumulative score
      if (b.cumulativeScore !== a.cumulativeScore) return b.cumulativeScore - a.cumulativeScore;
      // Tiebreak: efficiency
      return b.efficiency - a.efficiency;
    });

  for (let i = 0; i < entries.length; i++) {
    entries[i]!.rank = i + 1;
  }

  return entries;
}

/**
 * Format leaderboard as a box-drawing table string.
 */
export function formatLeaderboard(entries: LeaderboardEntry[]): string {
  if (entries.length === 0) return "(no results)";

  const headers = [
    "Rank",
    "Model",
    "Arm",
    "Cleared",
    "Highest",
    "Score",
    "Eff.",
    "Resil.",
    "Crux",
  ];

  const rows = entries.map((e) => [
    String(e.rank),
    e.model.length > 20 ? e.model.slice(0, 18) + ".." : e.model,
    e.arm,
    String(e.floorsCleared),
    String(e.highestFloor),
    String(e.cumulativeScore),
    e.efficiency.toFixed(4),
    e.resilience.toFixed(3),
    e.cruxComposite.toFixed(3),
  ]);

  // Calculate column widths
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]!.length)),
  );

  const pad = (s: string, w: number) => s + " ".repeat(w - s.length);

  // Box-drawing
  const top = "\u250c" + widths.map((w) => "\u2500".repeat(w + 2)).join("\u252c") + "\u2510";
  const mid = "\u251c" + widths.map((w) => "\u2500".repeat(w + 2)).join("\u253c") + "\u2524";
  const bot = "\u2514" + widths.map((w) => "\u2500".repeat(w + 2)).join("\u2534") + "\u2518";

  const fmtRow = (cells: string[]) =>
    "\u2502" + cells.map((c, i) => " " + pad(c, widths[i]!) + " ").join("\u2502") + "\u2502";

  const lines = [
    top,
    fmtRow(headers),
    mid,
    ...rows.map(fmtRow),
    bot,
  ];

  return lines.join("\n");
}
