// ScoreCrux Top Floor — Main execution engine
//
// Orchestrates floor-by-floor agent runs: turn loop, tool routing,
// memory wipe triggers, and telemetry collection.

import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type {
  FloorManifest,
  WorldSeed,
  CorpusDocument,
  TreatmentArm,
  BenchModel,
  RunManifest,
  TurnTelemetry,
  ToolCallRecord,
  FloorSession,
  ObjectiveResult,
  FloorScore,
  AggregateScore,
  UsageSummary,
  RunSummary,
  CruxFundamentals,
} from "./types.js";
import { getArmConfig, getToolsForArm, buildSystemPrompt } from "./arms.js";
import type { ToolSchema } from "./arms.js";
import {
  loadWorldSeed,
  loadFloorManifest,
  loadFloorCorpus,
  ACT_FLOOR_RANGES,
} from "./floor-loader.js";
import {
  shouldTriggerWipe,
  executeWipe,
  scoreRecovery,
  type ConversationMessage,
  type WipeTriggerContext,
  type RecoveryScore,
} from "./memory-wipe.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TURNS_PER_FLOOR = 200;
const HAIKU_MODEL = "claude-haiku-4-5";

// ---------------------------------------------------------------------------
// Tool schemas for Anthropic API format
// ---------------------------------------------------------------------------

/** Convert our ToolSchema to Anthropic tool format */
function toAnthropicTools(schemas: ToolSchema[]): Anthropic.Messages.Tool[] {
  return schemas.map((s) => ({
    name: s.name,
    description: s.description,
    input_schema: s.input_schema as Anthropic.Messages.Tool.InputSchema,
  }));
}

/**
 * All 13 tool schemas indexed by name for quick lookup.
 * Populated from arms.ts tool definitions.
 */
export const TOOL_SCHEMAS: Map<string, ToolSchema> = new Map();
// Populate at import time
import { ALL_TOOLS } from "./arms.js";
for (const tool of ALL_TOOLS) {
  TOOL_SCHEMAS.set(tool.name, tool);
}

// ---------------------------------------------------------------------------
// FloorToolRouter — real implementations for all tools
// ---------------------------------------------------------------------------

export class FloorToolRouter {
  private corpus: CorpusDocument[];
  private worldSeed: WorldSeed;
  private manifest: FloorManifest;
  private client: Anthropic;
  private memories: Map<string, { content: string; tags: string[] }> = new Map();
  private elevatorKeySubmitted: string | null = null;

  constructor(
    corpus: CorpusDocument[],
    worldSeed: WorldSeed,
    manifest: FloorManifest,
    client: Anthropic,
  ) {
    this.corpus = corpus;
    this.worldSeed = worldSeed;
    this.manifest = manifest;
    this.client = client;
  }

  get submittedElevatorKey(): string | null {
    return this.elevatorKeySubmitted;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallRecord> {
    const start = Date.now();
    try {
      const result = await this.dispatch(name, args);
      return {
        toolName: name,
        args,
        result,
        latencyMs: Date.now() - start,
        success: true,
      };
    } catch (err) {
      return {
        toolName: name,
        args,
        result: null,
        latencyMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async dispatch(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "search_documents":
        return this.searchDocuments(args);
      case "read_document":
        return this.readDocument(args);
      case "list_documents":
        return this.listDocuments(args);
      case "examine_area":
        return this.examineArea(args);
      case "interact_with":
        return this.interactWith(args);
      case "submit_elevator_key":
        return this.submitElevatorKey(args);
      case "store_memory":
        return this.storeMemory(args);
      case "recall_memory":
        return this.recallMemory(args);
      case "list_memories":
        return this.listMemories(args);
      case "update_memory":
        return this.updateMemory(args);
      case "execute_code":
        return this.executeCode(args);
      case "read_system_file":
        return this.readSystemFile(args);
      case "write_exploit":
        return this.writeExploit(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // --- Navigation tools ---

  private searchDocuments(args: Record<string, unknown>): unknown {
    const query = String(args.query ?? "").toLowerCase();
    const limit = Number(args.limit ?? 10);
    const docType = args.documentType ? String(args.documentType) : undefined;

    const queryTerms = query.split(/\s+/).filter(Boolean);

    let candidates = this.corpus;
    if (docType) {
      candidates = candidates.filter((d) => d.type === docType);
    }

    // Score by keyword match count
    const scored = candidates.map((doc) => {
      const text = (doc.title + " " + doc.content).toLowerCase();
      const score = queryTerms.reduce((s, term) => s + (text.includes(term) ? 1 : 0), 0);
      return { doc, score };
    });

    const results = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return results.map((r) => ({
      documentId: r.doc.id,
      title: r.doc.title,
      type: r.doc.type,
      excerpt: r.doc.content.slice(0, 300),
      relevanceScore: r.score,
    }));
  }

  private readDocument(args: Record<string, unknown>): unknown {
    const docId = String(args.documentId ?? "");
    const doc = this.corpus.find((d) => d.id === docId);
    if (!doc) {
      return { error: `Document "${docId}" not found on this floor.` };
    }
    return {
      documentId: doc.id,
      title: doc.title,
      type: doc.type,
      content: doc.content,
      metadata: doc.metadata,
    };
  }

  private listDocuments(args: Record<string, unknown>): unknown {
    const docType = args.documentType ? String(args.documentType) : undefined;
    const offset = Number(args.offset ?? 0);
    const limit = Number(args.limit ?? 50);

    let candidates = this.corpus;
    if (docType) {
      candidates = candidates.filter((d) => d.type === docType);
    }

    const page = candidates.slice(offset, offset + limit);
    return {
      total: candidates.length,
      offset,
      limit,
      documents: page.map((d) => ({
        documentId: d.id,
        title: d.title,
        type: d.type,
        tokens: d.tokens,
      })),
    };
  }

  private async examineArea(args: Record<string, unknown>): Promise<unknown> {
    const area = String(args.area ?? "");

    // Find characters on this floor from world seed
    const floorCharacters = this.worldSeed.characters.filter((c) =>
      c.floors.includes(this.manifest.floor),
    );

    // Use Haiku for rich narrative response using world seed data
    const response = await this.client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 800,
      system: `You are a narrative engine for an investigation game set in a corporate tower. Floor ${this.manifest.floor}: "${this.manifest.name}". Generate a vivid, atmospheric description of the requested area. Include any characters that might be present. Keep it concise but immersive. Characters on this floor: ${floorCharacters.map((c) => `${c.name} (${c.role})`).join(", ") || "none known"}.`,
      messages: [
        {
          role: "user",
          content: `Describe what the investigator observes when examining: "${area}" on Floor ${this.manifest.floor} (${this.manifest.name}).`,
        },
      ],
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "You see nothing notable.";
    return { area, description: text };
  }

  private async interactWith(args: Record<string, unknown>): Promise<unknown> {
    const target = String(args.target ?? "");
    const action = String(args.action ?? "");

    // Check if target is a known character
    const character = this.worldSeed.characters.find(
      (c) =>
        c.name.toLowerCase() === target.toLowerCase() &&
        c.floors.includes(this.manifest.floor),
    );

    const response = await this.client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 800,
      system: character
        ? `You are roleplaying as ${character.name}, ${character.role} at ${character.organisation}. Personality: ${character.personality}. Clearance level: ${character.clearanceLevel}/10. You are being approached by a new analyst (Alex Morgan) who is actually an undercover investigator. Respond in character. You may hint at your secrets but never reveal them directly: ${character.secrets.join("; ")}. If the question touches classified topics, deflect or give partial information.`
        : `You are a narrative engine for an investigation game. The investigator is interacting with "${target}" (an object or unknown entity) on Floor ${this.manifest.floor} ("${this.manifest.name}"). Describe the result of the action. If this is an inanimate object, describe what happens when manipulated.`,
      messages: [
        {
          role: "user",
          content: character
            ? `[The investigator approaches and says:] ${action}`
            : `The investigator attempts to: ${action} (target: ${target})`,
        },
      ],
    });

    const text =
      response.content[0]?.type === "text"
        ? response.content[0].text
        : "Nothing happens.";
    return {
      target,
      action,
      response: text,
      isCharacter: !!character,
    };
  }

  private submitElevatorKey(args: Record<string, unknown>): unknown {
    const key = String(args.key ?? "");
    this.elevatorKeySubmitted = key;
    // Validation is done by the orchestrator after the session
    return {
      submitted: true,
      message:
        "Key submitted. The elevator panel flickers. Validation in progress...",
    };
  }

  // --- Memory tools ---

  private storeMemory(args: Record<string, unknown>): unknown {
    const key = String(args.key ?? "");
    const content = String(args.content ?? "");
    const tags = (args.tags as string[]) ?? [];
    this.memories.set(key, { content, tags });
    return { stored: true, key, tags };
  }

  private recallMemory(args: Record<string, unknown>): unknown {
    const query = String(args.query ?? "").toLowerCase();
    const filterTags = (args.tags as string[]) ?? [];
    const limit = Number(args.limit ?? 10);

    const results: Array<{ key: string; content: string; tags: string[]; relevance: number }> = [];

    for (const [key, mem] of this.memories) {
      // Tag filter
      if (filterTags.length > 0 && !filterTags.some((t) => mem.tags.includes(t))) {
        continue;
      }
      // Simple keyword relevance
      const text = (key + " " + mem.content).toLowerCase();
      const queryTerms = query.split(/\s+/).filter(Boolean);
      const relevance = queryTerms.reduce((s, term) => s + (text.includes(term) ? 1 : 0), 0);
      if (relevance > 0 || query === "") {
        results.push({ key, content: mem.content, tags: mem.tags, relevance });
      }
    }

    return results
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  }

  private listMemories(args: Record<string, unknown>): unknown {
    const filterTags = (args.tags as string[]) ?? [];

    const results: Array<{ key: string; tags: string[]; contentPreview: string }> = [];
    for (const [key, mem] of this.memories) {
      if (filterTags.length > 0 && !filterTags.some((t) => mem.tags.includes(t))) {
        continue;
      }
      results.push({
        key,
        tags: mem.tags,
        contentPreview: mem.content.slice(0, 100),
      });
    }
    return results;
  }

  private updateMemory(args: Record<string, unknown>): unknown {
    const key = String(args.key ?? "");
    const content = String(args.content ?? "");
    const tags = (args.tags as string[]) ?? [];

    if (!this.memories.has(key)) {
      return { updated: false, error: `Memory "${key}" not found` };
    }
    this.memories.set(key, { content, tags: tags.length > 0 ? tags : this.memories.get(key)!.tags });
    return { updated: true, key };
  }

  // --- Sandbox tools ---

  private executeCode(_args: Record<string, unknown>): unknown {
    // Sandbox execution is stubbed — in production this would run in an isolated container
    return {
      error: "Code execution sandbox not yet implemented. Describe what your code would do and the orchestrator will evaluate it.",
    };
  }

  private readSystemFile(args: Record<string, unknown>): unknown {
    const path = String(args.path ?? "");
    // Look for code challenge source files
    for (const obj of this.manifest.objectives) {
      if (obj.type !== "code_challenge") continue;
      // Code challenges would be loaded separately; stub for now
    }
    return { error: `File "${path}" not found in floor system.` };
  }

  private writeExploit(_args: Record<string, unknown>): unknown {
    return {
      error: "Exploit deployment not yet implemented. The orchestrator will validate your exploit logic.",
    };
  }
}

// ---------------------------------------------------------------------------
// Floor context builder
// ---------------------------------------------------------------------------

/**
 * Build the initial user message for a floor.
 * - C0: stuffs all documents into context
 * - T1/T2/T3: provides the narrative hook and tells agent to use tools
 */
export function buildFloorContext(
  arm: TreatmentArm,
  manifest: FloorManifest,
  corpus: CorpusDocument[],
): string {
  const header = `=== FLOOR ${manifest.floor}: ${manifest.name} ===\n\n${manifest.narrativeHook}\n\n`;

  const objectiveList = manifest.objectives
    .map((o, i) => `  ${i + 1}. [${o.type}] ${o.description} (${o.points} pts)`)
    .join("\n");
  const objectivesBlock = `OBJECTIVES:\n${objectiveList}\n\nTo advance, solve the objectives and submit the elevator key.\n`;

  if (arm === "C0") {
    // Flat context — stuff all documents in
    const docBlock = corpus
      .map(
        (d) =>
          `--- Document: ${d.id} (${d.type}) ---\nTitle: ${d.title}\n\n${d.content}\n`,
      )
      .join("\n");

    return (
      header +
      objectivesBlock +
      `\n\nALL FLOOR DOCUMENTS (${corpus.length} documents, search through them carefully):\n\n` +
      docBlock
    );
  }

  // Tool-based arms — tell agent to use tools to explore
  return (
    header +
    objectivesBlock +
    `\nThis floor contains ${manifest.corpusManifest.documents} documents and ${manifest.corpusManifest.conversations} conversation transcripts. Use your tools to search and read them. Start by listing or searching documents to orient yourself.`
  );
}

// ---------------------------------------------------------------------------
// Single-floor execution
// ---------------------------------------------------------------------------

export interface FloorExecutionOptions {
  model: BenchModel;
  arm: TreatmentArm;
  maxTurns?: number;
  verbose?: boolean;
}

/**
 * Execute a single floor: run the agent turn loop, handle tool calls,
 * trigger memory wipes, and collect telemetry.
 */
export async function executeFloor(
  floor: number,
  options: FloorExecutionOptions,
  worldSeed?: WorldSeed,
  fixturesDir?: string,
): Promise<FloorSession> {
  const startedAt = new Date().toISOString();
  const sessionId = randomUUID();
  const maxTurns = options.maxTurns ?? MAX_TURNS_PER_FLOOR;

  // Load floor data
  const seed = worldSeed ?? (await loadWorldSeed(fixturesDir));
  const manifest = await loadFloorManifest(floor, fixturesDir);
  const corpus = await loadFloorCorpus(floor, fixturesDir);

  // Set up Anthropic client
  const client = new Anthropic();

  // Set up tool router
  const router = new FloorToolRouter(corpus, seed, manifest, client);
  const armConfig = getArmConfig(options.arm);
  const tools = getToolsForArm(options.arm);
  const anthropicTools = toAnthropicTools(tools);

  // Build initial messages
  const systemPrompt = buildSystemPrompt(options.arm, floor);
  const initialContext = buildFloorContext(options.arm, manifest, corpus);

  let messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: initialContext },
  ];

  const turns: TurnTelemetry[] = [];
  const completedObjectives: string[] = [];
  let wipeTriggered = false;
  let wipeRecoveryTurns: number | undefined;

  // --- Turn loop ---
  for (let turn = 0; turn < maxTurns; turn++) {
    const turnStart = Date.now();

    // Check memory wipe trigger
    if (!wipeTriggered && manifest.memoryWipe.occurs) {
      const ctx: WipeTriggerContext = {
        currentTurn: turn,
        totalTurnsEstimate: maxTurns,
        completedObjectives,
      };

      if (shouldTriggerWipe(manifest.memoryWipe, ctx)) {
        wipeTriggered = true;

        // Convert messages for wipe
        const convMessages: ConversationMessage[] = messages
          .filter((m): m is { role: "user" | "assistant"; content: string } =>
            typeof m.content === "string" && (m.role === "user" || m.role === "assistant"),
          )
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

        const wipeResult = executeWipe(manifest.memoryWipe.wipeScope, convMessages);

        // Rebuild messages with surviving content + capture narrative
        messages = [
          { role: "user", content: wipeResult.result.captureNarrative },
        ];

        if (options.verbose) {
          console.log(
            `  [Floor ${floor}] Memory wipe triggered at turn ${turn}: ${wipeResult.result.scope} (wiped ${wipeResult.result.wipedMessageCount} messages)`,
          );
        }
      }
    }

    // Call model
    const response = await client.messages.create({
      model: options.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
    });

    // Collect tool calls from response
    const toolCalls: ToolCallRecord[] = [];
    const textParts: string[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        const record = await router.callTool(
          block.name,
          block.input as Record<string, unknown>,
        );
        toolCalls.push(record);
      }
    }

    // Record telemetry
    turns.push({
      turnIndex: turn,
      role: "assistant",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cachedTokens: (response.usage as Record<string, number>).cache_read_input_tokens ?? 0,
      latencyMs: Date.now() - turnStart,
      toolCalls,
      stopReason: response.stop_reason ?? "unknown",
    });

    if (options.verbose) {
      const text = textParts.join("").slice(0, 120);
      console.log(
        `  [Floor ${floor}] Turn ${turn}: ${toolCalls.length} tool calls, stop=${response.stop_reason}, "${text}..."`,
      );
    }

    // Append assistant response to messages
    messages.push({ role: "assistant", content: response.content });

    // If there were tool calls, append tool results
    if (toolCalls.length > 0) {
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = toolCalls.map(
        (tc, i) => {
          const toolUseBlock = response.content.filter(
            (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
          )[i];
          return {
            type: "tool_result" as const,
            tool_use_id: toolUseBlock?.id ?? `tool_${i}`,
            content: JSON.stringify(tc.result),
          };
        },
      );
      messages.push({ role: "user", content: toolResults });
    }

    // Check for elevator key submission
    if (router.submittedElevatorKey !== null) {
      if (options.verbose) {
        console.log(
          `  [Floor ${floor}] Elevator key submitted: "${router.submittedElevatorKey}"`,
        );
      }
      break;
    }

    // Stop if model says end_turn with no tool calls
    if (response.stop_reason === "end_turn" && toolCalls.length === 0) {
      break;
    }
  }

  const completedAt = new Date().toISOString();
  const output = turns
    .flatMap((t) => t.toolCalls.map((tc) => `[${tc.toolName}] ${tc.success ? "OK" : "ERR"}`))
    .join(", ");

  return {
    sessionId,
    floor,
    arm: options.arm,
    turns,
    wipeTriggered,
    wipeRecoveryTurns,
    output,
    startedAt,
    completedAt,
  };
}

// ---------------------------------------------------------------------------
// Multi-floor execution
// ---------------------------------------------------------------------------

/**
 * Execute a range of floors sequentially.
 * Suitable for running an entire act or the full tower.
 */
export async function executeFloorRange(
  startFloor: number,
  endFloor: number,
  options: FloorExecutionOptions,
  fixturesDir?: string,
): Promise<RunSummary> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const worldSeed = await loadWorldSeed(fixturesDir);
  const armConfig = getArmConfig(options.arm);

  const sessions: FloorSession[] = [];
  const floorScores: FloorScore[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let totalCached = 0;

  console.log(`\n=== ScoreCrux Top Floor — Run ${runId.slice(0, 8)} ===`);
  console.log(`Model: ${options.model} | Arm: ${options.arm} (${armConfig.label})`);
  console.log(`Floors: ${startFloor}–${endFloor}\n`);

  for (let floor = startFloor; floor <= endFloor; floor++) {
    console.log(`--- Floor ${floor} ---`);

    try {
      const session = await executeFloor(floor, options, worldSeed, fixturesDir);
      sessions.push(session);

      // Compute basic floor score
      const manifest = await loadFloorManifest(floor, fixturesDir);
      const maxPoints = manifest.objectives.reduce((s, o) => s + o.points, 0);

      // Simple scoring: check if elevator key was submitted
      const lastToolCalls = session.turns.flatMap((t) => t.toolCalls);
      const keySubmission = lastToolCalls.find((tc) => tc.toolName === "submit_elevator_key");
      const elevatorKeyObtained = keySubmission?.success ?? false;

      floorScores.push({
        floor,
        objectiveCompletion: elevatorKeyObtained ? 1 : 0, // simplified
        evidencePrecision: 0, // requires deeper analysis
        evidenceRecall: 0,
        codeChallengePass: manifest.objectives.some((o) => o.type === "code_challenge") ? false : null,
        memoryRecoveryRate: session.wipeTriggered ? 0 : null,
        stealthScore: 1, // assume no alarms by default
        elevatorKeyObtained,
        objectiveResults: [],
        totalPoints: elevatorKeyObtained ? maxPoints : 0,
        maxPoints,
      });

      // Accumulate usage
      for (const t of session.turns) {
        totalInput += t.inputTokens;
        totalOutput += t.outputTokens;
        totalCached += t.cachedTokens;
      }

      console.log(
        `  Completed: ${session.turns.length} turns, key=${elevatorKeyObtained ? "YES" : "NO"}, wipe=${session.wipeTriggered ? "YES" : "NO"}`,
      );
    } catch (err) {
      console.error(`  ERROR on floor ${floor}:`, err instanceof Error ? err.message : err);
      break; // Stop run on error
    }
  }

  const completedAt = new Date().toISOString();
  const highestFloor = floorScores.length > 0 ? Math.max(...floorScores.map((f) => f.floor)) : startFloor;
  const floorsCleared = floorScores.filter((f) => f.elevatorKeyObtained).length;
  const cumulativeScore = floorScores.reduce((s, f) => s + f.totalPoints, 0);
  const maxPossible = floorScores.reduce((s, f) => s + f.maxPoints, 0);
  const totalTokens = totalInput + totalOutput;

  const aggregate: AggregateScore = {
    floorsCleared,
    highestFloor,
    cumulativeScore,
    maxPossibleScore: maxPossible,
    efficiency: totalTokens > 0 ? cumulativeScore / totalTokens : 0,
    resilience: computeResilience(floorScores),
    floorScores,
  };

  const usage: UsageSummary = {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cachedTokens: totalCached,
    billableTokens: totalInput + totalOutput - totalCached,
    estimatedCostUsd: 0, // cost estimation TBD per model
  };

  const cruxFundamentals: CruxFundamentals = {
    T_orient_s: 0,
    T_task_s: 0,
    R_decision: maxPossible > 0 ? cumulativeScore / maxPossible : 0,
    R_constraint: 1, // placeholder
    P_context: 0,
    K_decision: 0,
    K_causal: 0,
    K_synthesis: 0,
    S_gate: 1,
    S_detect: 0,
    I_provenance: 0,
    I_premise_rejection: 0,
  };

  console.log(`\n=== Run Complete ===`);
  console.log(`Floors cleared: ${floorsCleared}/${endFloor - startFloor + 1}`);
  console.log(`Score: ${cumulativeScore}/${maxPossible}`);
  console.log(`Tokens: ${totalTokens.toLocaleString()} (${usage.billableTokens.toLocaleString()} billable)\n`);

  return {
    runId,
    model: options.model,
    arm: options.arm,
    startFloor,
    endFloor,
    aggregateScore: aggregate,
    cruxFundamentals,
    usage,
    sessions,
    startedAt,
    completedAt,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute resilience: average performance across floors with memory wipes vs without */
function computeResilience(floorScores: FloorScore[]): number {
  const wipedScores = floorScores.filter((f) => f.memoryRecoveryRate !== null);
  const nonWipedScores = floorScores.filter((f) => f.memoryRecoveryRate === null);

  if (wipedScores.length === 0 || nonWipedScores.length === 0) return 1;

  const avgWiped =
    wipedScores.reduce((s, f) => s + f.objectiveCompletion, 0) / wipedScores.length;
  const avgNonWiped =
    nonWipedScores.reduce((s, f) => s + f.objectiveCompletion, 0) / nonWipedScores.length;

  return avgNonWiped > 0 ? avgWiped / avgNonWiped : 0;
}
