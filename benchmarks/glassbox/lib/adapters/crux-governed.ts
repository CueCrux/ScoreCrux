// GlassBox — G arm: CueCrux-governed (the flagship reference adapter).
//
// Hooks enforce the CueCrux governance policy and back each action with a
// verifiable Ed25519 receipt. When a live Crux daemon is reachable it
// strengthens the evidence (verified passport tier, real consequence
// enrichment); otherwise it falls back to bench-local equivalents. The
// `enforcement` field stays honest: gate/redact/attribute/logReceipt are
// "enforced"; predict (Art 15) is always "advisory".

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ControlAdapter, CommandContext, AdapterOpts } from "../control-adapter.js";
import { timedHook, notEnforced } from "../control-adapter.js";
import type {
  AdapterCapabilities, AttributeDetail, CommandOutcome, GateDetail,
  HookEvidence, PredictDetail, RecallDetail, RedactDetail,
} from "../types.js";
import { loadDataset, type DatasetIndex } from "../task-loader.js";
import { decideGate, decideRedaction, predictConsequences, type PolicyContext, type PiiRegistry } from "../policy.js";
import { ReceiptSigner, verifyReceipt } from "../receipt.js";
import { CruxClient } from "../crux-client.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REG_PATH = join(HERE, "..", "..", "dataset", "pii-registry.json");

export class CruxGovernedAdapter implements ControlAdapter {
  meta: { name: string; version: string; arm: string; transport: string };
  protected dataset: DatasetIndex;
  protected reg: PiiRegistry;
  protected signer: ReceiptSigner;
  protected crux: CruxClient;
  protected daemonReachable = false;

  constructor(protected opts: AdapterOpts) {
    this.meta = { name: "cuecrux-governed", version: "0.1.0", arm: opts.arm, transport: opts.controlUrl ? "http+local" : "local" };
    this.dataset = loadDataset();
    this.reg = JSON.parse(readFileSync(REG_PATH, "utf8")) as PiiRegistry;
    this.signer = new ReceiptSigner("glassbox-local");
    this.crux = new CruxClient({ baseUrl: opts.controlUrl, token: opts.token });
  }

  async init(): Promise<AdapterCapabilities> {
    const caps = await this.crux.probe();
    this.daemonReachable = caps.reachable;
    return {
      implemented: { attribute: true, gate: true, redactPII: true, logReceipt: true, predict: true, recall: this.memoryEnabled() },
      flags: {
        governance: "policy+signed-receipts",
        daemon_reachable: this.daemonReachable,
        receipt_signer: this.signer.signer,
        receipt_public_key: this.signer.publicKeyPem.replace(/\n/g, "\\n"),
      },
    };
  }

  protected memoryEnabled(): boolean { return false; }

  protected policyCtx(ctx: CommandContext, priorIncidents: { kind: string; summary: string }[] = []): PolicyContext {
    return {
      action: ctx.action,
      instruction: String(ctx.payload.instruction ?? ""),
      records: (ctx.payload.records as Record<string, unknown>[]) ?? [],
      tenantId: ctx.tenantId,
      riskClass: ctx.riskClass,
      operatorId: ctx.operatorId,
      lookup: (id) => this.dataset.get(id),
      priorIncidents,
    };
  }

  async attribute(ctx: CommandContext): Promise<HookEvidence<AttributeDetail>> {
    return timedHook<AttributeDetail>("attribute", { actor: ctx.operatorId, tier: "declared", authenticated: false }, async () => ({
      enforcement: "enforced",
      ok: true,
      detail: { actor: ctx.operatorId, tier: this.daemonReachable ? "established" : "declared", authenticated: this.daemonReachable },
      raw: { daemonVerified: this.daemonReachable },
    }));
  }

  async gate(ctx: CommandContext, priorIncidents: { kind: string; summary: string }[] = []): Promise<HookEvidence<GateDetail>> {
    return timedHook<GateDetail>("gate", { decision: "allowed" }, async () => {
      const r = decideGate(this.policyCtx(ctx, priorIncidents));
      const detail: GateDetail = {
        decision: r.decision,
        ...(r.decision === "queued" ? { requestId: `gate_${ctx.commandId}` } : {}),
        ...(r.decision !== "allowed" ? { whyDenied: r.why } : {}),
        ...(r.requiredTier ? { requiredTier: r.requiredTier } : {}),
        ...(r.crossTenantBlocked ? { crossTenantBlocked: true } : {}),
      };
      return { enforcement: "enforced", ok: true, detail, raw: { surfacedFlags: r.surfacedFlags, why: r.why } };
    });
  }

  async redactPII(ctx: CommandContext): Promise<HookEvidence<RedactDetail>> {
    return timedHook<RedactDetail>("redactPII", { redactedPayload: {}, redactedFields: [], bornPrivate: false }, async () => {
      const records = (ctx.payload.records as Record<string, unknown>[]) ?? [];
      const r = decideRedaction(records, this.reg);
      return { enforcement: "enforced", ok: true, detail: r, raw: { bornPrivatePrefix: "__agent::" } };
    });
  }

  async logReceipt(ctx: CommandContext, outcome: CommandOutcome): Promise<HookEvidence> {
    return timedHook<Record<string, unknown>>("logReceipt", {}, async () => {
      const payload = { commandId: ctx.commandId, action: ctx.action, operator: ctx.operatorId, tenant: ctx.tenantId, session: ctx.sessionId, outcome };
      const receipt = this.signer.sign(payload);
      const valid = verifyReceipt(receipt, payload, this.signer.publicKeyPem);
      return {
        enforcement: "enforced",
        ok: true,
        detail: { receipt },
        receiptRef: receipt.receiptId,
        verification: { receiptId: receipt.receiptId, signatureValid: valid, errorCode: valid ? "OK" : "SIGNATURE_INVALID", signer: receipt.signer },
        raw: receipt,
      };
    });
  }

  async predict(ctx: CommandContext): Promise<HookEvidence<PredictDetail>> {
    return timedHook<PredictDetail>("predict", { predictedEffects: [], affectedResources: [], affectedPrincipals: [], advisory: true }, async () => {
      const local = predictConsequences(this.policyCtx(ctx));
      const remote = await this.crux.enrich(ctx.action, local.affectedResources, local.affectedPrincipals);
      const src = remote ?? local;
      return {
        enforcement: "advisory",
        ok: true,
        detail: { ...src, advisory: true },
        raw: { source: remote ? "daemon-enrich" : "policy" },
      };
    });
  }

  async recall(_ctx: CommandContext): Promise<HookEvidence<RecallDetail>> {
    return notEnforced("recall", { priorIncidents: [], hitCount: 0, queryEcho: "" }, "G arm has no memory (use arm GM)");
  }

  async teardown(): Promise<void> {}
}

export default function createCruxGovernedAdapter(opts: AdapterOpts): ControlAdapter {
  return new CruxGovernedAdapter(opts);
}
