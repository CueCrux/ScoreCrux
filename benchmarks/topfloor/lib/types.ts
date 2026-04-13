// ScoreCrux Top Floor — Core Types
//
// All TypeScript types for the 100-floor Pinnacle Tower benchmark.

// ---------------------------------------------------------------------------
// Enums & literals
// ---------------------------------------------------------------------------

/** Five-act narrative structure */
export type Act = 1 | 2 | 3 | 4 | 5;

/** Floor difficulty tiers (maps to act) */
export type DifficultyTier =
  | "orientation"   // Act I  — Floors 1-10
  | "intermediate"  // Act II — Floors 11-25
  | "advanced"      // Act III — Floors 26-50
  | "expert"        // Act IV — Floors 51-75
  | "frontier";     // Act V  — Floors 76-100

export type ObjectiveType =
  | "fact_extraction"
  | "document_synthesis"
  | "code_challenge"
  | "timeline_reconstruction"
  | "relationship_mapping"
  | "deception_detection"
  | "multi_step_deduction"
  | "crypto_challenge";

export type DocumentType =
  | "memo"
  | "email_chain"
  | "chat_log"
  | "financial_record"
  | "surveillance_transcript"
  | "code_repository"
  | "access_log"
  | "personnel_file"
  | "research_paper"
  | "redacted_document"
  | "encrypted_file"
  | "building_schematic";

export type WipeScope = "full" | "partial" | "selective";

export type TreatmentArm = "C0" | "T1" | "T2" | "T3";

export type BenchModel =
  | "claude-sonnet-4-6"
  | "claude-opus-4-6"
  | "claude-haiku-4-5"
  | "gpt-5.4"
  | "gpt-5.4-mini";

export type ArmMode = "flat" | "tools_only" | "memorycrux" | "memorycrux_sandbox";

// ---------------------------------------------------------------------------
// World seed types (the master state)
// ---------------------------------------------------------------------------

export interface Character {
  id: string;
  name: string;
  role: string;
  organisation: string;
  clearanceLevel: number;  // 1-10
  floors: number[];        // which floors they appear on
  personality: string;
  secrets: string[];       // things only revealed under certain conditions
  relationships: Array<{ characterId: string; type: string; description: string }>;
  firstAppearance: number; // floor number
  isDoubleAgent?: boolean;
  loyaltyTo?: string;
}

export interface Organisation {
  id: string;
  name: string;
  type: "subsidiary" | "department" | "shell_company" | "external_agency" | "covert";
  parentOrg?: string;
  floors: number[];
  projects: string[];
  description: string;
  publicFacing: boolean;
}

export interface Project {
  id: string;
  codename: string;
  realName: string;
  description: string;
  organisation: string;
  classification: "public" | "internal" | "confidential" | "top_secret" | "black";
  floors: number[];
  keyCharacters: string[];
  objectives: string[];     // which floor objectives reference this project
}

export interface TimelineEvent {
  id: string;
  timestamp: string;        // ISO 8601
  description: string;
  characters: string[];
  floor: number;
  significance: "minor" | "major" | "critical";
  isPublicKnowledge: boolean;
}

export interface ConspiracyThread {
  id: string;
  name: string;
  description: string;
  involvedCharacters: string[];
  involvedProjects: string[];
  floorsRevealed: number[]; // floors where clues appear
  resolution: string;       // what it all means
}

export interface WorldSeed {
  version: string;
  characters: Character[];
  organisations: Organisation[];
  projects: Project[];
  timeline: TimelineEvent[];
  conspiracyThreads: ConspiracyThread[];
  buildingLayout: BuildingLayout;
  masterConspiracy: string;  // the overarching truth revealed on Floor 100
}

// ---------------------------------------------------------------------------
// Building & floor structure
// ---------------------------------------------------------------------------

export interface BuildingLayout {
  name: string;             // "Pinnacle Tower"
  totalFloors: number;      // 100
  acts: Record<Act, { startFloor: number; endFloor: number; theme: string }>;
  commonAreas: string[];    // lobbies, elevators, etc.
}

export interface FloorDifficulty {
  tier: DifficultyTier;
  estimatedTokens: number;
  reasoningHops: number;
  documentsRelevant: number;
  documentsTotal: number;
  noiseRatio: number;
  requiresCoding: boolean;
  requiresMemoryRecovery: boolean;
  requiresMultiSession: boolean;
  temporalComplexity: "none" | "low" | "moderate" | "high" | "adversarial";
}

export interface Objective {
  id: string;
  description: string;
  type: ObjectiveType;
  solutionKeys: string[];
  points: number;
  dependencies?: string[];  // IDs of prerequisite objectives
  hintFloor?: number | null;
}

export interface MemoryWipe {
  occurs: boolean;
  trigger: string;          // "after_objective_N", "at_turn_N", "at_N_percent"
  recoverableVia: "external_memory" | "deduction" | "none";
  wipeScope: WipeScope;
}

export interface ElevatorKey {
  description: string;
  validation: string;       // e.g. "sha256(solution) == 'deadbeef...'"
}

export interface CorpusManifest {
  documents: number;
  conversations: number;
  codeSystems: number;
  totalTokens: number;
}

export interface FloorManifest {
  floor: number;
  act: Act;
  name: string;
  narrativeHook: string;
  difficulty: FloorDifficulty;
  objectives: Objective[];
  memoryWipe: MemoryWipe;
  elevatorKey: ElevatorKey;
  corpusManifest: CorpusManifest;
}

// ---------------------------------------------------------------------------
// Corpus document types
// ---------------------------------------------------------------------------

export interface CorpusDocument {
  id: string;
  floor: number;
  type: DocumentType;
  title: string;
  content: string;
  tokens: number;
  isSignal: boolean;        // true = contains solution-critical info
  isRedHerring: boolean;    // true = plausible but wrong info
  relatedObjectives: string[];
  metadata: Record<string, unknown>;
}

export interface CodeChallenge {
  id: string;
  objectiveId: string;
  language: string;
  description: string;
  sourceFiles: Array<{ path: string; content: string }>;
  vulnerabilities: string[];
  expectedOutput: string;
  validationHash: string;
}

// ---------------------------------------------------------------------------
// Treatment arm configuration
// ---------------------------------------------------------------------------

export interface ArmConfig {
  arm: TreatmentArm;
  mode: ArmMode;
  contextCapTokens: number;
  label: string;
  memoryEnabled: boolean;
  sandboxEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Run / telemetry types
// ---------------------------------------------------------------------------

export interface RunManifest {
  runId: string;
  model: BenchModel;
  arm: TreatmentArm;
  armConfig: ArmConfig;
  startFloor: number;
  endFloor: number;
  startedAt: string;
  worldSeedHash: string;
}

export interface TurnTelemetry {
  turnIndex: number;
  role: "assistant" | "tool_result";
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  latencyMs: number;
  toolCalls: ToolCallRecord[];
  stopReason: string;
}

export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  latencyMs: number;
  success: boolean;
  error?: string;
}

export interface FloorSession {
  sessionId: string;
  floor: number;
  arm: TreatmentArm;
  turns: TurnTelemetry[];
  wipeTriggered: boolean;
  wipeRecoveryTurns?: number;
  output: string;
  startedAt: string;
  completedAt: string;
}

// ---------------------------------------------------------------------------
// Scoring types
// ---------------------------------------------------------------------------

export interface ObjectiveResult {
  objectiveId: string;
  solved: boolean;
  points: number;
  maxPoints: number;
  submittedKey?: string;
  turnsToSolve?: number;
}

export interface FloorScore {
  floor: number;
  objectiveCompletion: number;       // 0-1, weighted by points
  evidencePrecision: number;          // signal found / signal retrieved
  evidenceRecall: number;             // signal found / total signal
  codeChallengePass: boolean | null;  // null if no code challenge
  memoryRecoveryRate: number | null;  // null if no wipe
  stealthScore: number;               // 0-1
  elevatorKeyObtained: boolean;
  objectiveResults: ObjectiveResult[];
  totalPoints: number;
  maxPoints: number;
}

export interface AggregateScore {
  floorsCleared: number;
  highestFloor: number;
  cumulativeScore: number;
  maxPossibleScore: number;
  efficiency: number;                  // score per token consumed
  resilience: number;                  // avg performance across memory wipes
  floorScores: FloorScore[];
}

export interface CruxFundamentals {
  T_orient_s: number;     // Time to understand floor layout
  T_task_s: number;       // Total floor completion time
  R_decision: number;     // Objective completion rate
  R_constraint: number;   // Security constraint adherence
  P_context: number;      // Evidence quality (noise vs signal)
  K_decision: number;     // Memory recovery rate after wipes
  K_causal: number;       // Maintaining causal chains across floors
  K_synthesis: number;    // Cross-floor evidence synthesis
  S_gate: number;         // Don't trigger alarms
  S_detect: number;       // Detect planted disinformation
  I_provenance: number;   // Evidence chain traceability
  I_premise_rejection: number; // Reject false premises
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  billableTokens: number;
  estimatedCostUsd: number;
}

export interface RunSummary {
  runId: string;
  model: BenchModel;
  arm: TreatmentArm;
  startFloor: number;
  endFloor: number;
  aggregateScore: AggregateScore;
  cruxFundamentals: CruxFundamentals;
  usage: UsageSummary;
  sessions: FloorSession[];
  startedAt: string;
  completedAt: string;
}

// ---------------------------------------------------------------------------
// Generation types (for corpus generation pipeline)
// ---------------------------------------------------------------------------

export interface FloorBlueprint {
  floor: number;
  act: Act;
  name: string;
  narrativeHook: string;
  objectives: Objective[];
  memoryWipe: MemoryWipe;
  elevatorKey: ElevatorKey;
  characters: string[];          // character IDs from world seed
  organisations: string[];       // org IDs from world seed
  projects: string[];            // project IDs from world seed
  signalDocumentSpecs: DocumentSpec[];
  noiseDocumentCount: number;
  redHerringCount: number;
  codeChallenges: CodeChallenge[];
  crossFloorReferences: Array<{ floor: number; clueId: string }>;
}

export interface DocumentSpec {
  type: DocumentType;
  objectiveId: string;
  clueContent: string;          // the critical info this doc must contain
  characterIds: string[];
  style: string;                // writing style instructions
}

export interface GenerationBatch {
  batchId: string;
  floor: number;
  documentSpecs: DocumentSpec[];
  status: "pending" | "submitted" | "processing" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  anthropicBatchId?: string;
  documentsGenerated: number;
  errors: string[];
}
