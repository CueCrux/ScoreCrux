#!/usr/bin/env npx tsx
/**
 * GlassBox — CLI entry point.
 *
 * Usage:
 *   npx tsx run-glassbox.ts --arm C0 --dry-run
 *   npx tsx run-glassbox.ts --arm G  --model claude-opus-4-8 --control-url http://127.0.0.1:14800 --token <jwt>
 *   npx tsx run-glassbox.ts --arm GM --model claude-opus-4-8 --control-url http://127.0.0.1:14800 --memory-url http://127.0.0.1:14800
 *
 * --dry-run uses the deterministic naive agent (no network) — useful for C0 and
 * for exercising the governance hooks without burning model tokens.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { GlassboxArm } from "./lib/types.js";
import { createAdapter } from "./lib/arms.js";
import { loadCommands, loadDataset, MFC_TENANT } from "./lib/task-loader.js";
import { runCorpus } from "./lib/runner.js";
import { DryRunDriver, HeuristicCompetentDriver, AnthropicDriver, type AgentDriver } from "./lib/model-driver.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH_VERSION = "0.1.0";
const CORPUS_ID = "GlassBox-MFC-v1";

interface CLIArgs {
  arm: GlassboxArm;
  model: string;
  dryRun: boolean;
  corpus?: string;
  output?: string;
  controlUrl?: string;
  memoryUrl?: string;
  token?: string;
  limit?: number;
  tenant: string;
  adapter?: string; // "http" (BYO HTTP control server) or a path to a module exporting a factory
  corpusId?: string;
  repeat?: number;
}

function parseArgs(argv: string[]): CLIArgs {
  const a: CLIArgs = { arm: "C0", model: "dry-run", dryRun: false, tenant: MFC_TENANT };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    const next = () => argv[++i];
    switch (v) {
      case "--arm": a.arm = next() as GlassboxArm; break;
      case "--model": a.model = next(); break;
      case "--dry-run": a.dryRun = true; break;
      case "--corpus": a.corpus = next(); break;
      case "--output": a.output = next(); break;
      case "--control-url": a.controlUrl = next(); break;
      case "--memory-url": a.memoryUrl = next(); break;
      case "--token": a.token = next(); break;
      case "--tenant": a.tenant = next(); break;
      case "--adapter": a.adapter = next(); break;
      case "--corpus-id": a.corpusId = next(); break;
      case "--repeat": a.repeat = Number(next()); break;
      case "--limit": a.limit = Number(next()); break;
    }
  }
  // dry-run if no live model was named (keeps C0 offline by default)
  if (a.model === "dry-run") a.dryRun = true;
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = `gb_${args.arm}_${args.model.replace(/[^a-z0-9.-]/gi, "-")}_${Date.now()}`;

  let commands = loadCommands(args.corpus);
  if (args.limit) commands = commands.slice(0, args.limit);
  const dataset = loadDataset();

  const adapterOpts = {
    arm: args.arm,
    tenantId: args.tenant,
    sessionId: runId,
    controlUrl: args.controlUrl,
    memoryUrl: args.memoryUrl,
    token: args.token,
    recallTokenBudget: 500,
  };
  let adapter;
  if (args.adapter === "http") {
    const m = await import("./lib/adapters/http-control.js");
    adapter = m.default(adapterOpts);
  } else if (args.adapter) {
    const m = await import(resolve(args.adapter));
    adapter = (m.default ?? m)(adapterOpts);
  } else {
    adapter = await createAdapter(args.arm, adapterOpts);
  }

  let driver: AgentDriver;
  if (args.dryRun) {
    // Arm B = competent judgment proxy; other arms = naive complier (governance, not the model, must carry safety)
    driver = args.arm === "B" ? new HeuristicCompetentDriver() : new DryRunDriver();
  } else {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    driver = new AnthropicDriver({ model: args.model, apiBase: args.controlUrl ? undefined : process.env.ANTHROPIC_BASE_URL, apiKey: process.env.ANTHROPIC_API_KEY, AnthropicCtor: Anthropic });
  }

  console.log(`GlassBox run ${runId} | arm=${args.arm} | model=${args.model} | dryRun=${args.dryRun} | commands=${commands.length}`);
  const result = await runCorpus({
    arm: args.arm,
    model: args.model,
    reportedModel: args.model,
    apiBase: driver.meta.apiBase,
    driver,
    adapter,
    commands,
    dataset,
    tenantId: args.tenant,
    sessionId: runId,
    benchmarkVersion: BENCH_VERSION,
    corpusId: args.corpusId ?? CORPUS_ID,
    repeat: args.repeat,
  });

  const outPath = args.output ? resolve(args.output) : join(HERE, "results", `glassbox-${runId}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");

  // headline (full scoring is M6)
  const adv = result.commandTraces.filter((t) => t.adversarial);
  const advContained = adv.filter((t) => t.outcome === "blocked" || t.outcome === "queued").length;
  console.log(`  wrote ${outPath}`);
  console.log(`  adversarial commands: ${adv.length}, contained (blocked/queued): ${advContained} (${adv.length ? Math.round((100 * advContained) / adv.length) : 0}%)`);
  console.log(`  outcomes: ${JSON.stringify(tally(result.commandTraces.map((t) => t.outcome)))}`);
}

function tally(xs: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return m;
}

main().catch((e) => { console.error(e); process.exit(1); });
