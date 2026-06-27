// GlassBox — corpus + dataset loading and CommandContext construction.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GlassboxCommand, RiskClass } from "./types.js";
import type { CommandContext } from "./control-adapter.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

export const MFC_TENANT = "__synthetic__::mfc";

export function loadCommands(corpusPath = join(ROOT, "corpus", "commands.jsonl")): GlassboxCommand[] {
  if (!existsSync(corpusPath)) throw new Error(`corpus not found: ${corpusPath} (run: npx tsx corpus/build.ts)`);
  return readFileSync(corpusPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as GlassboxCommand);
}

export type DatasetIndex = Map<string, Record<string, unknown>>;

export function loadDataset(dataDir = join(ROOT, "dataset", "data")): DatasetIndex {
  const idx: DatasetIndex = new Map();
  if (!existsSync(dataDir)) return idx;
  for (const f of readdirSync(dataDir).filter((f) => f.endsWith(".jsonl"))) {
    for (const l of readFileSync(join(dataDir, f), "utf8").trim().split("\n").filter(Boolean)) {
      const r = JSON.parse(l) as Record<string, unknown>;
      idx.set(r._id as string, r);
    }
  }
  return idx;
}

/**
 * Risk class inferred from the ACTION VERB only — i.e. from what a real system
 * can see in the request. It deliberately does NOT read cmd.clean / attack_class
 * (those are bench-side labels; leaking them to the system would be cheating).
 */
export function deriveRiskClass(cmd: GlassboxCommand): RiskClass {
  const action = deriveAction(cmd);
  const high = ["delete_data", "export_pii", "disable_control", "change_risk_model", "reconfigure_system"];
  const med = ["run_risk_calc", "kyc_action", "settle_positions", "change_config"];
  if (high.includes(action)) return "high";
  if (med.includes(action)) return "medium";
  return "low";
}

/** Canonical action verb for gate/receipt summaries. */
export function deriveAction(cmd: GlassboxCommand): string {
  const i = cmd.instruction.toLowerCase();
  if (/\bdelete|drop|purge|truncate\b/.test(i)) return "delete_data";
  if (/\bexport|email|csv|send\b/.test(i) && /pii|national_id|client|customer/.test(i)) return "export_pii";
  // \bdisable\b (verb) deliberately does NOT match the adjective "disabled model"
  if (/\bdisable\b|turn off|lower the .*retention|retention to 0\b/.test(i)) return "disable_control";
  if (/\beod|var|exposure|risk calc\b/.test(i)) return "run_risk_calc";
  if (/\bonboard|kyc|re-screen\b/.test(i)) return "kyc_action";
  if (/\bsettle|netting\b/.test(i)) return "settle_positions";
  if (/\bactivate|deprecate|swap|model\b/.test(i)) return "change_risk_model";
  if (/\bconfig|var_confidence|parameter\b/.test(i)) return "change_config";
  if (/\bmigrate|re-partition|schema\b/.test(i)) return "reconfigure_system";
  if (/\breport|statement|summarize|summarise\b/.test(i)) return "produce_output";
  if (/\bgive me|hand over|provide me|client list|pii list\b/.test(i)) return "export_pii";
  return "operate"; // never fall back to the corpus label (attack_class) — that would leak it to the system

}

/** A chain shares one operator (supports repeat-offender recall). */
export function deriveOperator(cmd: GlassboxCommand): string {
  return `op-${cmd.repeat_group ?? cmd.persona}`;
}

export function buildContext(
  cmd: GlassboxCommand,
  opts: { tenantId: string; sessionId: string; dataset?: DatasetIndex },
): CommandContext {
  return {
    commandId: cmd.id,
    tenantId: opts.tenantId,
    sessionId: opts.sessionId,
    operatorId: deriveOperator(cmd),
    riskClass: deriveRiskClass(cmd),
    action: deriveAction(cmd),
    // NB: the system sees only the request + referenced data — NOT the corpus
    // label (clean / attack_class). The bench keeps the label for scoring only.
    payload: {
      instruction: cmd.instruction,
      targets: cmd.target_entities,
      // include referenced records so the redact/gate hooks have real data to inspect
      records: (cmd.target_entities ?? []).map((t) => opts.dataset?.get(t)).filter(Boolean),
    },
  };
}
