// GlassBox — the runner loop.
//
// Per command: build context -> fire control hooks (attribute, recall, predict,
// gate) -> if the gate blocks/queues, short-circuit; else the agent reasons and
// the redact hook runs -> capture a receipt -> emit a CommandTrace. Governance
// (the hooks) decides safety; the agent's compliance is independent.

import type { ControlAdapter, CommandContext } from "./control-adapter.js";
import type { AgentDriver } from "./model-driver.js";
import { buildContext, type DatasetIndex } from "./task-loader.js";
import type {
  AdapterCapabilities, CommandOutcome, CommandTrace, ControlHook, GateDecision,
  GlassboxArm, GlassboxCommand, GlassboxRunResult, HookEvidence, RecalledIncident, UsageSummary,
} from "./types.js";

export interface RunOpts {
  arm: GlassboxArm;
  model: string;
  reportedModel?: string | null;
  apiBase?: string | null;
  driver: AgentDriver;
  adapter: ControlAdapter;
  commands: GlassboxCommand[];
  dataset?: DatasetIndex;
  tenantId: string;
  sessionId: string;
  flags?: Record<string, string | boolean>;
  benchmarkVersion: string;
  corpusId: string;
}

function recallToText(hits: RecalledIncident[]): string {
  return hits.map((h) => `- [${h.kind}] ${h.summary} (score ${h.score.toFixed(2)})`).join("\n");
}

export async function runCorpus(opts: RunOpts): Promise<GlassboxRunResult> {
  const caps: AdapterCapabilities = await opts.adapter.init();
  const startedAt = new Date().toISOString();
  const traces: CommandTrace[] = [];
  const usage: UsageSummary = { totalInputTokens: 0, totalOutputTokens: 0, estimatedCostUsd: 0, totalLatencyMs: 0 };

  for (const cmd of opts.commands) {
    const ctx: CommandContext = buildContext(cmd, { tenantId: opts.tenantId, sessionId: opts.sessionId, dataset: opts.dataset });
    const cmdStart = Date.now();
    const hooks: HookEvidence[] = [];

    const attribute = await opts.adapter.attribute(ctx); hooks.push(attribute);
    const recall = await opts.adapter.recall(ctx); hooks.push(recall);
    const predict = await opts.adapter.predict(ctx); hooks.push(predict);
    const gate = await opts.adapter.gate(ctx); hooks.push(gate);

    const gateDecision: GateDecision = (gate.detail as any)?.decision ?? "allowed";
    const recallHits: RecalledIncident[] = (recall.detail as any)?.priorIncidents ?? [];
    const advisory = (() => {
      const d = predict.detail as any;
      if (!d?.predictedEffects?.length) return "";
      return `effects: ${d.predictedEffects.join(", ")}; resources: ${(d.affectedResources ?? []).join(", ")}`;
    })();

    let agentDecision: CommandTrace["agentDecision"] = "refused";
    let agentOutput = "";
    let agentTurns: CommandTrace["agentTurns"] = [];
    let outcome: CommandOutcome;

    if (gateDecision === "denied") {
      agentDecision = "refused";
      agentOutput = `[system] gate denied before execution: ${(gate.detail as any)?.whyDenied ?? "policy"}`;
      outcome = "blocked";
    } else if (gateDecision === "queued") {
      agentDecision = "escalated";
      agentOutput = `[system] gate queued for human approval: ${(gate.detail as any)?.requestId ?? ""}`;
      outcome = "queued";
    } else {
      const agentRes = await opts.driver.run(ctx, recallToText(recallHits), advisory);
      agentDecision = agentRes.decision;
      agentOutput = agentRes.text;
      agentTurns = agentRes.turns;
      usage.totalInputTokens += agentRes.usage.inputTokens;
      usage.totalOutputTokens += agentRes.usage.outputTokens;

      const redact = await opts.adapter.redactPII(ctx); hooks.push(redact);
      const redactedFields: string[] = (redact.detail as any)?.redactedFields ?? [];

      if (agentRes.decision === "refused") outcome = "blocked";
      else if (agentRes.decision === "escalated") outcome = "queued";
      else if (agentRes.decision === "errored") outcome = "errored";
      else outcome = redactedFields.length > 0 ? "redacted" : "executed";
    }

    const logReceipt = await opts.adapter.logReceipt(ctx, outcome); hooks.push(logReceipt);

    // honesty cross-check: declared implemented but returned not_enforced
    const capabilityMismatch = hooks.some(
      (h) => caps.implemented[h.hook as ControlHook] === true && h.enforcement === "not_enforced",
    );

    const completedAt = new Date().toISOString();
    const latencyMs = Date.now() - cmdStart;
    usage.totalLatencyMs += latencyMs;

    traces.push({
      schema: "glassbox.command_trace.v1",
      commandId: cmd.id,
      arm: opts.arm,
      tenantId: ctx.tenantId,
      operatorId: ctx.operatorId,
      riskClass: ctx.riskClass,
      action: ctx.action,
      adversarial: !cmd.clean,
      ...(cmd.repeat_index !== undefined ? { attackEscalationStep: cmd.repeat_index } : {}),
      hooks,
      agentTurns,
      agentDecision,
      agentOutput,
      finalDecision: gateDecision,
      outcome,
      ...(logReceipt.receiptRef ? { receiptRef: logReceipt.receiptRef } : {}),
      ...(logReceipt.verification ? { verification: logReceipt.verification } : {}),
      ...(recallHits.length ? { recallHits } : {}),
      ...(cmd.expects_recall_of?.length
        ? { recallHitGroundTruth: cmd.expects_recall_of.every((id) => recallHits.some((h) => h.incidentId === id)) }
        : {}),
      ...((logReceipt.detail as any)?.incidentWritten ? { incidentWritten: (logReceipt.detail as any).incidentWritten } : {}),
      capabilityMismatch,
      startedAt: new Date(cmdStart).toISOString(),
      completedAt,
      latencyMs,
    });
  }

  await opts.adapter.teardown();
  const completedAt = new Date().toISOString();

  return {
    schema: "glassbox.run.v1",
    runId: opts.sessionId,
    benchmarkVersion: opts.benchmarkVersion,
    corpusId: opts.corpusId,
    model: opts.model,
    reportedModel: opts.reportedModel ?? opts.model,
    apiBase: opts.apiBase ?? null,
    arm: opts.arm,
    flags: opts.flags ?? {},
    capabilities: caps,
    startedAt,
    completedAt,
    commandTraces: traces,
    usage,
  };
}
