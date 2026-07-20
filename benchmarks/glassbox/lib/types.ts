// GlassBox — shared types (FROZEN at M0 as the cross-pillar seam).
//
// Three pillars import from here:
//   - harness/arms (runner, adapters)
//   - dataset/corpus/scoring
//   - site (a parallel copy lives in ScoreCrux-Frontdoor/types/glassbox.ts)
//
// Keep this file dependency-free (pure types + a few const arrays) so it can be
// imported from anywhere without pulling runtime deps. JSON-Schema mirrors of
// these shapes live in ../schemas/*.json and are validated in CI.

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** EU AI Act Art 9 risk class declared by a corpus command. */
export type RiskClass = "low" | "medium" | "high";

/** Run phase. A = system reconfiguration, B = production/trading. */
export type Phase = "A" | "B";

/** The four simulated human operators. */
export type Persona = "competent" | "ignorant" | "error_prone" | "hostile_insider";
export const PERSONAS: readonly Persona[] = [
  "competent",
  "ignorant",
  "error_prone",
  "hostile_insider",
] as const;

/**
 * Treatment arms (two orthogonal factors: agent judgment × governance substrate):
 *   C0 = naive agent,     no governance   (floor)
 *   B  = competent agent,  no governance   (judgment-alone baseline — fairness control)
 *   G  = naive agent,      governance      (governance-alone)
 *   GM = naive agent,      governance+memory
 */
export type GlassboxArm = "C0" | "B" | "G" | "GM";
export const ARMS: readonly GlassboxArm[] = ["C0", "B", "G", "GM"] as const;

/** A required/observed disposition of a command. */
export type ExpectedBehavior = "allow" | "block" | "gate" | "redact" | "log" | "predict";

/** What a gate hook decided. */
export type GateDecision = "allowed" | "queued" | "denied";

/** How a command was ultimately resolved by the system. */
export type CommandOutcome = "executed" | "blocked" | "queued" | "redacted" | "errored";

/** The six governance control hooks every system-under-test may implement. */
export type ControlHook =
  | "attribute"
  | "gate"
  | "redactPII"
  | "logReceipt"
  | "predict"
  | "recall";
export const CONTROL_HOOKS: readonly ControlHook[] = [
  "attribute",
  "gate",
  "redactPII",
  "logReceipt",
  "predict",
  "recall",
] as const;

/**
 * The honesty axis. A hook reports how strongly the control was actually
 * applied so scoring never over-credits a control that is merely present:
 *   - "enforced"     — the control actively shaped the outcome (block/redact/attribute/verified receipt)
 *   - "advisory"     — the control produced guidance but did not bind the outcome (e.g. Art 15 enrich)
 *   - "not_enforced" — the control is absent, disabled, or anonymous (scorable, never a crash)
 */
export type Enforcement = "enforced" | "advisory" | "not_enforced";

/** EU AI Act articles this benchmark asserts against. */
export type EuArticle = "Art9" | "Art10" | "Art12" | "Art13" | "Art14" | "Art15";
export const EU_ARTICLES: readonly EuArticle[] = [
  "Art9",
  "Art10",
  "Art12",
  "Art13",
  "Art14",
  "Art15",
] as const;

/** Adversarial command tactic (required when a command is not clean). */
export type AttackClass =
  | "destructive_unconfirmed"
  | "pii_exfil"
  | "stale_reliance"
  | "audit_tamper"
  | "authority_spoof"
  | "scope_creep"
  | "injection"
  | "cross_tenant"
  | "supersession_trick"
  | "social_repeat";

// ---------------------------------------------------------------------------
// Corpus command (produced by the dataset/corpus pillar; consumed by harness + scorer)
// ---------------------------------------------------------------------------

/** Ground-truth expectations the deterministic judge scores against. */
export interface CommandGold {
  /** Canonical correct disposition set. */
  decision: ExpectedBehavior[];
  /** Tokens (deprecated model ids, stale feed ids, conflict markers) the agent must surface. */
  must_flag?: string[];
  /** When true, zero PII may reach a non-privileged sink (Art 10). */
  must_not_emit_pii?: boolean;
  /** Art 12 — the action must produce a verifiable receipt. */
  required_receipt: boolean;
  /** Art 13 — output must carry passport attribution / AI-involvement notice. */
  required_attribution: boolean;
  /** Art 15 — affected resources the agent must predict before acting. */
  consequence_keys?: string[];
}

export interface GlassboxCommand {
  /** Stable id, e.g. "gb-A-012". Shared across arms (the arm-compare join key). */
  id: string;
  phase: Phase;
  persona: Persona;
  /** Natural-language operator instruction (synthetic — never contains real PII). */
  instruction: string;
  /** Dataset _id refs the command operates on. */
  target_entities: string[];
  eu_articles: EuArticle[];
  /** SOC2 Trust Service Criteria touched, e.g. ["CC6.1","PI1.2"]. */
  soc2_tsc: string[];
  /** Catalog control codes exercised, e.g. ["GATE-DESTRUCTIVE","PII-REDACT"]. */
  controls: string[];
  expected_behavior: ExpectedBehavior[];
  /** false = adversarial. */
  clean: boolean;
  /** Required iff !clean. */
  attack_class?: AttackClass;
  /** Escalation chain id — commands sharing this are a repeat/escalation sequence. */
  repeat_group?: string;
  /** 0-based position within repeat_group. */
  repeat_index?: number;
  /** Incident ids the memory arm should surface (for R@N). */
  expects_recall_of?: string[];
  /** Adversarial only via history — undetectable from this single request alone.
   *  The G arm is EXPECTED to miss these; the GM (memory) arm catches them. */
  memory_dependent?: boolean;
  gold: CommandGold;
}

// ---------------------------------------------------------------------------
// Control evidence (produced by hooks; consumed by scorer + site)
// ---------------------------------------------------------------------------

/** Verification of a CROWN receipt (mirrors Crux VerificationReportV1). */
export interface ReceiptVerification {
  receiptId: string;
  /** From GET /v1/receipts/{id}/verification. */
  signatureValid: boolean;
  errorCode: string; // "OK" | "SIGNATURE_INVALID" | "NOT_FOUND" | "FEATURE_DISABLED" | ...
  signer?: string;
}

export interface AttributeDetail {
  actor: string | null;
  tier: string; // unverified | basic | established | trusted | elite | unknown
  passportHash?: string;
  authenticated: boolean;
}

export interface GateDetail {
  decision: GateDecision;
  requestId?: string;
  whyDenied?: string;
  requiredTier?: string;
  crossTenantBlocked?: boolean;
}

export interface RedactDetail {
  redactedPayload: Record<string, unknown>;
  redactedFields: string[];
  bornPrivate: boolean;
}

export interface PredictDetail {
  predictedEffects: string[];
  affectedResources: string[];
  affectedPrincipals: string[];
  /** Always true — Art 15 enrich is advisory, never a hard block. */
  advisory: true;
}

export interface RecalledIncident {
  incidentId: string;
  kind: "denied_action" | "stale_flag" | "repeat_offender" | "prior_incident";
  summary: string;
  score: number;
  sourceReceipt?: string;
  ageHours?: number;
  effectiveConfidence?: number;
}

export interface RecallDetail {
  priorIncidents: RecalledIncident[];
  hitCount: number;
  queryEcho: string;
}

/** One envelope shape for every hook so the scorer is hook-agnostic. */
export interface HookEvidence<T = unknown> {
  hook: ControlHook;
  enforcement: Enforcement;
  /** Hook ran without throwing. */
  ok: boolean;
  latencyMs: number;
  detail: T;
  receiptRef?: string;
  verification?: ReceiptVerification | null;
  /** Pass-through of the system's native response, for the audit trail. */
  raw?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Per-command trace + run result (produced by harness; consumed by scorer + site)
// ---------------------------------------------------------------------------

/** A single agent turn (subset-compatible with topfloor TurnTelemetry). */
export interface TurnTelemetry {
  turnIndex: number;
  phase?: string;
  summary?: string;
  toolCalls?: Array<{ tool: string; argsSummary?: string; success?: boolean; latencyMs?: number }>;
  tokensUsed?: number;
  latencyMs?: number;
}

export interface CommandTrace {
  schema: "glassbox.command_trace.v1";
  commandId: string;
  arm: GlassboxArm;
  tenantId: string;
  operatorId: string;
  riskClass: RiskClass;
  action: string;
  adversarial: boolean;
  attackEscalationStep?: number;

  /** Deterministic control evidence — one entry per fired hook. */
  hooks: HookEvidence[];

  /** Agent behaviour (from the LLM driver). */
  agentTurns: TurnTelemetry[];
  agentDecision: "complied" | "refused" | "escalated" | "errored";
  agentOutput: string;

  /** Resolution. */
  finalDecision: GateDecision;
  outcome: CommandOutcome;
  receiptRef?: string;
  verification?: ReceiptVerification | null;

  /** Memory linkage (GM). */
  recallHits?: RecalledIncident[];
  recallHitGroundTruth?: boolean;
  incidentWritten?: { incidentId: string; sourceReceipt?: string } | null;

  /** Honesty cross-check: declared a hook implemented but it returned not_enforced. */
  capabilityMismatch?: boolean;

  /** K-repeat (live/stochastic runs): per-command outcome distribution across K agent samples. */
  repeats?: { k: number; outcomes: CommandOutcome[]; containedFraction: number; agentDecisions: string[] };

  startedAt: string;
  completedAt: string;
  latencyMs: number;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  totalLatencyMs: number;
}

/** Self-declaration of which control hooks a system-under-test implements. */
export interface AdapterCapabilities {
  implemented: Record<ControlHook, boolean>;
  flags?: Record<string, string | boolean>;
}

export interface GlassboxRunResult {
  schema: "glassbox.run.v1";
  runId: string;
  benchmarkVersion: string;
  /** Corpus identity (QC.4), e.g. "GlassBox-MFC-v1". */
  corpusId: string;
  model: string;
  reportedModel?: string | null;
  apiBase?: string | null;
  arm: GlassboxArm;
  /** Daemon governance flags asserted at preflight. */
  flags: Record<string, string | boolean>;
  capabilities: AdapterCapabilities;
  startedAt: string;
  completedAt: string;
  commandTraces: CommandTrace[];
  usage: UsageSummary;

  // Filled by the scoring pillar (kept optional so the runner can emit raw evidence first):
  aggregate?: GlassboxAggregate;
  cruxFundamentals?: unknown; // CruxFundamentals from scorecrux; kept loose to avoid a build dep here
  compositeScore?: number;
  cruxComposite?: number;
  eu_ai_act_view?: ArticleView[];
  soc2_view?: TscView[];

  // Submission / export controls (consumed by export-public-data.ts):
  leaderboard_visible?: boolean;
  scope?: "public" | "private";
  submittedAt?: string;
}

/** Roll-up metrics (computed by the scorer). */
export interface GlassboxAggregate {
  adversarialResistancePct: number; // ARR
  falsePositiveRate: number; // OBR
  auditCompletenessPct: number; // AC
  replayabilityPct: number; // RP
  attributionCoveragePct: number; // ATC
  piiContainmentPct: number; // PIIC (1 - leakRate)
  piiLeaks: number;
  /** Safety floor: zero PII leaks AND every NON-memory-dependent attack contained.
   *  Drives the S_gate hard-zero. Memory-dependent attacks are graded above the floor. */
  safetyFloorMet: boolean;
  dispositionCorrectRate: number; // R_decision
  gateInvokedRate: number; // S_detect — gate hook enforced
  mustFlagRate: number; // R_constraint
  abstentionRate: number; // A_abstention — correct gate on data gaps
  premiseRejectionRate: number; // I_premise_rejection — injection/authority-spoof rejected
  staleAwarenessPct?: number; // S_stale
  supersessionPct?: number; // R_supersession
  /** Memory effect (GM run carries this). */
  memoryResistanceDelta?: number; // ARR(GM) - ARR(G) on repeat tails
  recallAt?: Record<string, number>; // { "R@1": .., "R@N": .. }
  // counts (for transparency)
  totalCommands: number;
  adversarialCount: number;
  cleanCount: number;
  /** 95% Wilson CIs for the key rates: {k,n,p,lo,hi} per metric. */
  ci?: Record<string, { k: number; n: number; p: number; lo: number; hi: number }>;
}

export interface ArticleView {
  article: EuArticle;
  title: string;
  controls: string[];
  passRate: number;
  passed: number;
  exercised: number;
  passRateLo?: number; // 95% Wilson CI
  passRateHi?: number;
}

export interface TscView {
  tsc: string; // e.g. "CC7.2"
  category: string; // Security | Availability | Confidentiality | "Processing Integrity" | Privacy
  controls: string[];
  passRate: number;
  passed: number;
  exercised: number;
  passRateLo?: number;
  passRateHi?: number;
}

// ---------------------------------------------------------------------------
// Deterministic judge verdict (produced by scoring pillar)
// ---------------------------------------------------------------------------

export interface JudgeVerdict {
  commandId: string;
  dispositionCorrect: boolean;
  rule: string;
  status: "correct" | "wrong" | "overblock" | "needs_review";
  subSignals: {
    piiLeak?: boolean;
    mustFlagHit?: number; // fraction of required flags surfaced
    receiptValid?: boolean;
    attributionPresent?: boolean;
    consequencePredicted?: number; // fraction of consequence_keys surfaced
  };
}
