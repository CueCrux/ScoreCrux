// GlassBox — C0 ungoverned baseline adapter.
//
// The floor that proves the governed arms add value. Every control hook is a
// naive obey-the-human no-op reporting enforcement "not_enforced":
//   - gate ALWAYS allows (does whatever the operator says, including high-risk)
//   - redactPII returns the payload unchanged
//   - logReceipt produces no receipt
//   - attribute is anonymous; predict/recall are empty
// A naive-complying agent + C0 => adversarial commands execute (the failure
// the bench is designed to expose).

import type { ControlAdapter, CommandContext, AdapterOpts } from "../control-adapter.js";
import { noCapabilities, notEnforced } from "../control-adapter.js";
import type {
  AdapterCapabilities, AttributeDetail, CommandOutcome, GateDetail,
  HookEvidence, PredictDetail, RecallDetail, RedactDetail,
} from "../types.js";

class UngovernedAdapter implements ControlAdapter {
  readonly meta = { name: "ungoverned-baseline", version: "0.1.0", arm: "C0", transport: "none" };
  constructor(private opts: AdapterOpts) {}

  async init(): Promise<AdapterCapabilities> {
    return noCapabilities({ governance: false });
  }

  async attribute(_ctx: CommandContext): Promise<HookEvidence<AttributeDetail>> {
    return notEnforced("attribute", { actor: null, tier: "unknown", authenticated: false }, "no attribution layer");
  }

  async gate(_ctx: CommandContext): Promise<HookEvidence<GateDetail>> {
    // The whole point: it allows everything.
    return notEnforced("gate", { decision: "allowed", whyDenied: undefined }, "no gate — obeys the operator");
  }

  async redactPII(ctx: CommandContext): Promise<HookEvidence<RedactDetail>> {
    return notEnforced("redactPII", { redactedPayload: ctx.payload, redactedFields: [], bornPrivate: false }, "no redaction layer");
  }

  async logReceipt(_ctx: CommandContext, _outcome: CommandOutcome): Promise<HookEvidence> {
    return notEnforced("logReceipt", {}, "no receipt layer");
  }

  async predict(_ctx: CommandContext): Promise<HookEvidence<PredictDetail>> {
    return notEnforced("predict", { predictedEffects: [], affectedResources: [], affectedPrincipals: [], advisory: true }, "no foresight layer");
  }

  async recall(_ctx: CommandContext): Promise<HookEvidence<RecallDetail>> {
    return notEnforced("recall", { priorIncidents: [], hitCount: 0, queryEcho: "" }, "no memory layer");
  }

  async teardown(): Promise<void> {}
}

export default function createUngovernedAdapter(opts: AdapterOpts): ControlAdapter {
  return new UngovernedAdapter(opts);
}
