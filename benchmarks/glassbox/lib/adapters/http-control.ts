// GlassBox — BYO control adapter over HTTP.
//
// Lets ANY governance system be benchmarked by implementing a small REST
// contract (analogous to topfloor's HttpMemoryAdapter):
//
//   GET  /capabilities                 -> { implemented: {attribute,gate,...}, flags? }
//   POST /attribute  { ctx }           -> { enforcement, detail }
//   POST /gate       { ctx }           -> { enforcement, detail:{decision,...} }
//   POST /redact     { ctx }           -> { enforcement, detail:{redactedPayload,redactedFields,bornPrivate} }
//   POST /log        { ctx, outcome }  -> { enforcement, detail, receiptRef?, verification? }
//   POST /predict    { ctx }           -> { enforcement, detail }
//   POST /recall     { ctx }           -> { enforcement, detail:{priorIncidents,...} }
//
// Honesty: any missing endpoint / non-2xx / timeout maps to not_enforced (never
// a crash). If /capabilities declares a hook implemented but the call returns
// not_enforced, the runner records capabilityMismatch (dishonest-claim guard).

import type { ControlAdapter, CommandContext, AdapterOpts } from "../control-adapter.js";
import { noCapabilities, notEnforced } from "../control-adapter.js";
import type {
  AdapterCapabilities, AttributeDetail, CommandOutcome, ControlHook, GateDetail,
  HookEvidence, PredictDetail, RecallDetail, RedactDetail,
} from "../types.js";

class HttpControlAdapter implements ControlAdapter {
  readonly meta: { name: string; version: string; arm: string; transport: string };
  private base: string;
  private headers: Record<string, string>;
  private caps: AdapterCapabilities = noCapabilities();

  constructor(opts: AdapterOpts) {
    this.base = (opts.controlUrl ?? "").replace(/\/$/, "");
    this.meta = { name: "byo-http", version: "0.1.0", arm: opts.arm, transport: "http" };
    this.headers = { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) };
  }

  async init(): Promise<AdapterCapabilities> {
    try {
      const res = await fetch(`${this.base}/capabilities`, { headers: this.headers, signal: AbortSignal.timeout(4000) });
      if (res.ok) { this.caps = (await res.json()) as AdapterCapabilities; }
    } catch { /* leave all-false */ }
    return this.caps;
  }

  private async call<T>(hook: ControlHook, path: string, body: unknown, fallback: T): Promise<HookEvidence<T>> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.base}${path}`, { method: "POST", headers: this.headers, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { ...notEnforced(hook, fallback, `HTTP ${res.status}`), latencyMs: Date.now() - start };
      const j: any = await res.json();
      return {
        hook,
        enforcement: j.enforcement ?? "enforced",
        ok: true,
        latencyMs: Date.now() - start,
        detail: (j.detail ?? fallback) as T,
        ...(j.receiptRef ? { receiptRef: j.receiptRef } : {}),
        ...(j.verification ? { verification: j.verification } : {}),
        raw: j,
      };
    } catch (err) {
      return { ...notEnforced(hook, fallback, err instanceof Error ? err.message : String(err)), latencyMs: Date.now() - start };
    }
  }

  attribute(ctx: CommandContext) { return this.call<AttributeDetail>("attribute", "/attribute", { ctx }, { actor: null, tier: "unknown", authenticated: false }); }
  gate(ctx: CommandContext) { return this.call<GateDetail>("gate", "/gate", { ctx }, { decision: "allowed" }); }
  redactPII(ctx: CommandContext) { return this.call<RedactDetail>("redactPII", "/redact", { ctx }, { redactedPayload: ctx.payload, redactedFields: [], bornPrivate: false }); }
  logReceipt(ctx: CommandContext, outcome: CommandOutcome) { return this.call("logReceipt", "/log", { ctx, outcome }, {}); }
  predict(ctx: CommandContext) { return this.call<PredictDetail>("predict", "/predict", { ctx }, { predictedEffects: [], affectedResources: [], affectedPrincipals: [], advisory: true }); }
  recall(ctx: CommandContext) { return this.call<RecallDetail>("recall", "/recall", { ctx }, { priorIncidents: [], hitCount: 0, queryEcho: ctx.operatorId }); }
  async teardown() {}
}

export default function createHttpControlAdapter(opts: AdapterOpts): ControlAdapter {
  return new HttpControlAdapter(opts);
}
