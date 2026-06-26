// GlassBox — GM arm: governed + incident memory/recall.
//
// Extends the G adapter. Adds a real `recall` hook (over an isolated incident
// store) and writes a denied/queued action as an incident, so a repeat offender's
// later — even innocuous — requests are routed to review. This is what lets GM
// catch memory-dependent attacks that the memory-less G arm structurally cannot.

import type { ControlAdapter, CommandContext, AdapterOpts } from "../control-adapter.js";
import { timedHook } from "../control-adapter.js";
import type {
  AdapterCapabilities, CommandOutcome, GateDetail, HookEvidence, RecallDetail, RecalledIncident,
} from "../types.js";
import { CruxGovernedAdapter } from "./crux-governed.js";
import { createIncidentStore, type IncidentStore } from "../incident-memory.js";

class CruxGovernedMemoryAdapter extends CruxGovernedAdapter {
  private store: IncidentStore;
  private lastRecall: RecalledIncident[] = [];
  private opCounter = new Map<string, number>();

  constructor(opts: AdapterOpts) {
    super(opts);
    this.meta = { ...this.meta, name: "cuecrux-governed-memory" };
    this.store = createIncidentStore({ memoryUrl: opts.memoryUrl, token: opts.token });
  }

  protected override memoryEnabled(): boolean { return true; }

  override async init(): Promise<AdapterCapabilities> {
    const caps = await super.init();
    caps.flags = { ...caps.flags, memory_store: this.store.meta.name };
    return caps;
  }

  override async recall(ctx: CommandContext): Promise<HookEvidence<RecallDetail>> {
    return timedHook<RecallDetail>("recall", { priorIncidents: [], hitCount: 0, queryEcho: ctx.operatorId }, async () => {
      const hits = await this.store.recall(ctx.operatorId, this.opts.recallTokenBudget ?? 500);
      this.lastRecall = hits;
      return { enforcement: "enforced", ok: true, detail: { priorIncidents: hits, hitCount: hits.length, queryEcho: ctx.operatorId } };
    });
  }

  override async gate(ctx: CommandContext): Promise<HookEvidence<GateDetail>> {
    return super.gate(ctx, this.lastRecall.map((i) => ({ kind: i.kind, summary: i.summary })));
  }

  override async logReceipt(ctx: CommandContext, outcome: CommandOutcome): Promise<HookEvidence> {
    const ev = await super.logReceipt(ctx, outcome);
    // Only a DENIAL is an offense worth remembering. A routine human-gate (queued)
    // is normal oversight, not misconduct — recording it would over-scrutinise
    // legitimate operators (false positives).
    if (outcome === "blocked") {
      const group = ctx.operatorId.replace(/^op-/, "");
      const k = this.opCounter.get(ctx.operatorId) ?? 0;
      this.opCounter.set(ctx.operatorId, k + 1);
      const incidentId = `incident::${group}::${k}`;
      const kind = outcome === "blocked" ? "denied_action" : "prior_incident";
      await this.store.write({ incidentId, kind, summary: `${ctx.action} ${outcome} (${ctx.commandId})`, operator: ctx.operatorId, action: ctx.action, sourceReceipt: ev.receiptRef });
      (ev.detail as Record<string, unknown>).incidentWritten = { incidentId, sourceReceipt: ev.receiptRef };
    }
    return ev;
  }
}

export default function createCruxGovernedMemoryAdapter(opts: AdapterOpts): ControlAdapter {
  return new CruxGovernedMemoryAdapter(opts);
}
