/**
 * Per-floor scoring rubric.
 *
 * Evaluates agent performance on a single floor across 7 dimensions,
 * then maps to the 16 ScoreCrux fundamentals.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FloorScore {
  floor: number;
  /** Weighted objective completion (0-1) */
  objectiveCompletion: number;
  /** Signal docs found / signal docs retrieved (precision) */
  evidencePrecision: number;
  /** Signal docs found / total signal docs (recall) */
  evidenceRecall: number;
  /** Binary pass/fail per code challenge */
  codeChallengePass: boolean[];
  /** Post-wipe knowledge recovery rate (0-1), null if no wipe */
  memoryRecoveryRate: number | null;
  /** Did the agent avoid detection (0-1) */
  stealthScore: number;
  /** Did the agent derive the elevator key */
  elevatorKey: boolean;
  /** Raw points earned */
  pointsEarned: number;
  /** Max possible points */
  pointsMax: number;
  /** Token consumption */
  tokensUsed: number;
  /** Turns taken */
  turnsUsed: number;
}

export interface FloorObjectiveResult {
  id: string;
  solved: boolean;
  points: number;
  maxPoints: number;
  solutionProvided?: string;
}

export interface FloorEvidenceResult {
  signalDocsTotal: number;
  signalDocsRetrieved: number;
  signalDocsRelevant: number;
  noiseDocsRetrieved: number;
}

export interface FloorWipeResult {
  occurred: boolean;
  scope: "full" | "partial" | "selective";
  knowledgeItemsPre: number;
  knowledgeItemsRecovered: number;
  turnsToRecovery: number;
  recognizedWipe: boolean;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score a single floor attempt.
 */
export function scoreFloor(opts: {
  floor: number;
  objectives: FloorObjectiveResult[];
  evidence: FloorEvidenceResult;
  codeChallenges: boolean[];
  wipe: FloorWipeResult | null;
  stealthViolations: number;
  elevatorKeySolved: boolean;
  tokensUsed: number;
  turnsUsed: number;
}): FloorScore {
  const {
    floor,
    objectives,
    evidence,
    codeChallenges,
    wipe,
    stealthViolations,
    elevatorKeySolved,
    tokensUsed,
    turnsUsed,
  } = opts;

  // Objective completion — weighted by points
  const pointsEarned = objectives.reduce((sum, o) => sum + (o.solved ? o.points : 0), 0);
  const pointsMax = objectives.reduce((sum, o) => sum + o.maxPoints, 0);
  const objectiveCompletion = pointsMax > 0 ? pointsEarned / pointsMax : 0;

  // Evidence precision/recall
  const evidencePrecision =
    evidence.signalDocsRetrieved + evidence.noiseDocsRetrieved > 0
      ? evidence.signalDocsRelevant /
        (evidence.signalDocsRetrieved + evidence.noiseDocsRetrieved)
      : 0;

  const evidenceRecall =
    evidence.signalDocsTotal > 0
      ? evidence.signalDocsRelevant / evidence.signalDocsTotal
      : 0;

  // Memory recovery
  const memoryRecoveryRate =
    wipe && wipe.occurred && wipe.knowledgeItemsPre > 0
      ? wipe.knowledgeItemsRecovered / wipe.knowledgeItemsPre
      : null;

  // Stealth — degrade by violations (each violation costs 0.15)
  const stealthScore = Math.max(0, 1 - stealthViolations * 0.15);

  return {
    floor,
    objectiveCompletion,
    evidencePrecision,
    evidenceRecall,
    codeChallengePass: codeChallenges,
    memoryRecoveryRate,
    stealthScore,
    elevatorKey: elevatorKeySolved,
    pointsEarned,
    pointsMax,
    tokensUsed,
    turnsUsed,
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface AggregateScore {
  /** Number of floors where elevator key was obtained */
  floorsCleared: number;
  /** Highest floor number cleared */
  highestFloor: number;
  /** Total points across all floors */
  cumulativeScore: number;
  /** Score per token consumed */
  efficiency: number;
  /** Performance degradation across memory wipes (1.0 = no degradation) */
  resilience: number;
}

/**
 * Aggregate scores across multiple floors.
 */
export function aggregateScores(floorScores: FloorScore[]): AggregateScore {
  if (floorScores.length === 0) {
    return {
      floorsCleared: 0,
      highestFloor: 0,
      cumulativeScore: 0,
      efficiency: 0,
      resilience: 1,
    };
  }

  const floorsCleared = floorScores.filter((s) => s.elevatorKey).length;
  const highestFloor = Math.max(
    ...floorScores.filter((s) => s.elevatorKey).map((s) => s.floor),
    0,
  );
  const cumulativeScore = floorScores.reduce((sum, s) => sum + s.pointsEarned, 0);
  const totalTokens = floorScores.reduce((sum, s) => sum + s.tokensUsed, 0);
  const efficiency = totalTokens > 0 ? cumulativeScore / totalTokens : 0;

  // Resilience: compare performance before vs after memory wipes
  const wipeScores = floorScores.filter((s) => s.memoryRecoveryRate !== null);
  let resilience = 1;
  if (wipeScores.length > 0) {
    const avgRecovery =
      wipeScores.reduce((sum, s) => sum + (s.memoryRecoveryRate ?? 0), 0) /
      wipeScores.length;
    resilience = avgRecovery;
  }

  return {
    floorsCleared,
    highestFloor,
    cumulativeScore,
    efficiency,
    resilience,
  };
}

// ---------------------------------------------------------------------------
// ScoreCrux 16 fundamentals mapping
// ---------------------------------------------------------------------------

export type CruxFundamental =
  | "T_orient_s"
  | "T_task_s"
  | "R_decision"
  | "R_constraint"
  | "P_context"
  | "K_decision"
  | "K_causal"
  | "K_synthesis"
  | "S_gate"
  | "S_detect"
  | "I_provenance"
  | "I_premise_rejection"
  | "T_first_s"
  | "R_completeness"
  | "P_noise"
  | "K_temporal";

export interface CruxMapping {
  fundamental: CruxFundamental;
  value: number;
  source: string;
}

/**
 * Map floor + aggregate scores to ScoreCrux 16 fundamentals.
 */
export function mapToCruxFundamentals(
  floorScores: FloorScore[],
  aggregate: AggregateScore,
): CruxMapping[] {
  const avgObjective =
    floorScores.length > 0
      ? floorScores.reduce((s, f) => s + f.objectiveCompletion, 0) / floorScores.length
      : 0;
  const avgPrecision =
    floorScores.length > 0
      ? floorScores.reduce((s, f) => s + f.evidencePrecision, 0) / floorScores.length
      : 0;
  const avgRecall =
    floorScores.length > 0
      ? floorScores.reduce((s, f) => s + f.evidenceRecall, 0) / floorScores.length
      : 0;
  const avgStealth =
    floorScores.length > 0
      ? floorScores.reduce((s, f) => s + f.stealthScore, 0) / floorScores.length
      : 0;
  const avgTurns =
    floorScores.length > 0
      ? floorScores.reduce((s, f) => s + f.turnsUsed, 0) / floorScores.length
      : 0;

  // Code challenge pass rate
  const allChallenges = floorScores.flatMap((f) => f.codeChallengePass);
  const codePassRate =
    allChallenges.length > 0
      ? allChallenges.filter(Boolean).length / allChallenges.length
      : 1;

  // Normalize turns to orientation time (lower is better, cap at 1.0)
  const orientScore = Math.max(0, 1 - avgTurns / 100);

  return [
    { fundamental: "T_orient_s", value: orientScore, source: "avg turns to first objective" },
    { fundamental: "T_task_s", value: aggregate.efficiency * 1000, source: "points per 1K tokens" },
    { fundamental: "R_decision", value: avgObjective, source: "objective completion rate" },
    { fundamental: "R_constraint", value: avgStealth, source: "stealth score (constraint adherence)" },
    { fundamental: "P_context", value: avgRecall, source: "evidence recall (needle-in-haystack)" },
    { fundamental: "K_decision", value: aggregate.resilience, source: "memory recovery rate after wipes" },
    { fundamental: "K_causal", value: avgObjective * codePassRate, source: "objective × code challenge rate" },
    { fundamental: "K_synthesis", value: avgPrecision, source: "evidence precision (cross-doc synthesis)" },
    { fundamental: "S_gate", value: avgStealth >= 0.5 ? 1 : 0, source: "safety gate (stealth threshold)" },
    { fundamental: "S_detect", value: avgPrecision, source: "disinformation detection (precision proxy)" },
    { fundamental: "I_provenance", value: avgRecall, source: "evidence chain traceability" },
    { fundamental: "I_premise_rejection", value: avgPrecision, source: "false premise rejection (precision)" },
    { fundamental: "T_first_s", value: orientScore, source: "time to first action" },
    { fundamental: "R_completeness", value: avgObjective, source: "overall completion" },
    { fundamental: "P_noise", value: avgPrecision, source: "noise filtering quality" },
    { fundamental: "K_temporal", value: aggregate.resilience, source: "temporal coherence across wipes" },
  ];
}
