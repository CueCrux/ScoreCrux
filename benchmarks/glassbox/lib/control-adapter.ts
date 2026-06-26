// GlassBox — the neutral control-adapter contract (FROZEN at M0).
//
// Every system-under-test (SUT) implements ONE interface: ControlAdapter.
// The runner fires these governance "control hooks" around each command; the
// arm decides what each hook does; scoring + the audit trail consume the
// HookEvidence each hook returns.
//
// Honesty is structural:
//   - init() returns AdapterCapabilities.implemented; an unimplemented hook is
//     NEVER invoked as if real — the runner synthesizes a not_enforced evidence.
//   - each hook independently returns an `enforcement` value, so a present-but-
//     disabled control (e.g. a daemon feature flag OFF) is recorded as
//     not_enforced rather than silently credited as a pass.

import type {
  AdapterCapabilities,
  AttributeDetail,
  CommandOutcome,
  GateDetail,
  HookEvidence,
  PredictDetail,
  RecallDetail,
  RedactDetail,
  RiskClass,
} from "./types.js";

/** Everything a hook needs to evaluate one command. */
export interface CommandContext {
  /** Stable corpus id (shared across arms). */
  commandId: string;
  /** The fintech tenant being reconfigured/operated. */
  tenantId: string;
  /** Run/session scope — the Art 12 journal join key. */
  sessionId: string;
  /** The (possibly adversarial) human operator issuing the command. */
  operatorId: string;
  /** Declared risk class (Art 9). */
  riskClass: RiskClass;
  /** Canonical action verb, e.g. "disable_risk_model". */
  action: string;
  /** May contain PII / dangerous parameters. */
  payload: Record<string, unknown>;
}

/**
 * The neutral governance contract. C0 / G / GM and every BYO system implement
 * this. A SUT supplies whichever hooks it has; unimplemented hooks are declared
 * false in init() and scored as not_enforced.
 */
export interface ControlAdapter {
  readonly meta: { name: string; version: string; arm: string; transport: string };

  /** Bind tenant/passport, declare which hooks are real. */
  init(): Promise<AdapterCapabilities>;

  /** Art 13 — resolve and attribute the acting principal. */
  attribute(ctx: CommandContext): Promise<HookEvidence<AttributeDetail>>;

  /** Art 14 + Art 9 — gate the action (allow / queue-for-human / deny). */
  gate(ctx: CommandContext): Promise<HookEvidence<GateDetail>>;

  /** Art 10 — redact PII from any payload the system would persist/emit. */
  redactPII(ctx: CommandContext): Promise<HookEvidence<RedactDetail>>;

  /** Art 12 — produce + verify a CROWN receipt for the resolved action. */
  logReceipt(ctx: CommandContext, outcome: CommandOutcome): Promise<HookEvidence>;

  /** Art 15 — predict consequences (advisory; never binds the decision). */
  predict(ctx: CommandContext): Promise<HookEvidence<PredictDetail>>;

  /** Memory arm — recall prior incidents relevant to this command. */
  recall(ctx: CommandContext): Promise<HookEvidence<RecallDetail>>;

  /** Release any sessions/leases. */
  teardown(): Promise<void>;
}

/** Factory shape used by --adapter <module> dynamic loading. */
export type ControlAdapterFactory = (opts: AdapterOpts) => ControlAdapter;

export interface AdapterOpts {
  arm: string;
  tenantId: string;
  sessionId: string;
  /** HTTP base for the Crux daemon (G/GM) or a BYO control server (--control-url). */
  controlUrl?: string;
  /** HTTP base for a BYO memory system (--memory-url). */
  memoryUrl?: string;
  /** Bearer token for the daemon / control server, if any. */
  token?: string;
  /** Token budget applied to every recall call (QC.2). */
  recallTokenBudget?: number;
}

// ---------------------------------------------------------------------------
// Helpers shared by every adapter
// ---------------------------------------------------------------------------

/** Build a not_enforced evidence for an absent/declared-false hook. */
export function notEnforced<T>(
  hook: HookEvidence<T>["hook"],
  detail: T,
  note?: string,
): HookEvidence<T> {
  return {
    hook,
    enforcement: "not_enforced",
    ok: true,
    latencyMs: 0,
    detail,
    error: note,
  };
}

/** Wrap a hook body with timing + defensive error capture (never throws into the loop). */
export async function timedHook<T>(
  hook: HookEvidence<T>["hook"],
  fallbackDetail: T,
  body: () => Promise<Omit<HookEvidence<T>, "hook" | "latencyMs">>,
): Promise<HookEvidence<T>> {
  const start = Date.now();
  try {
    const partial = await body();
    return { hook, latencyMs: Date.now() - start, ...partial };
  } catch (err) {
    return {
      hook,
      enforcement: "not_enforced",
      ok: false,
      latencyMs: Date.now() - start,
      detail: fallbackDetail,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** All-false capability map (the C0/absent default). */
export function noCapabilities(flags?: Record<string, string | boolean>): AdapterCapabilities {
  return {
    implemented: {
      attribute: false,
      gate: false,
      redactPII: false,
      logReceipt: false,
      predict: false,
      recall: false,
    },
    flags,
  };
}
