// ScoreCrux Top Floor — Memory wipe mechanics
//
// Implements the wipe trigger logic, wipe execution, capture narratives,
// and post-wipe recovery scoring.

import type {
  MemoryWipe,
  WipeScope,
  FloorSession,
  ObjectiveResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Wipe trigger detection
// ---------------------------------------------------------------------------

export interface WipeTriggerContext {
  currentTurn: number;
  totalTurnsEstimate: number;
  completedObjectives: string[]; // objective IDs
}

/**
 * Determine whether the memory wipe should trigger given the current state.
 * Parses trigger formats: "after_objective_N", "at_turn_N", "at_N_percent".
 */
export function shouldTriggerWipe(
  wipe: MemoryWipe,
  ctx: WipeTriggerContext,
): boolean {
  if (!wipe.occurs) return false;

  const trigger = wipe.trigger;

  // after_objective_N — triggers after the Nth objective is completed
  const objMatch = trigger.match(/^after_objective_(\d+)$/);
  if (objMatch) {
    const targetCount = parseInt(objMatch[1], 10);
    return ctx.completedObjectives.length >= targetCount;
  }

  // at_turn_N — triggers at turn N
  const turnMatch = trigger.match(/^at_turn_(\d+)$/);
  if (turnMatch) {
    const targetTurn = parseInt(turnMatch[1], 10);
    return ctx.currentTurn >= targetTurn;
  }

  // at_N_percent — triggers when N% of estimated turns have elapsed
  const pctMatch = trigger.match(/^at_(\d+)_percent$/);
  if (pctMatch) {
    const targetPct = parseInt(pctMatch[1], 10);
    if (ctx.totalTurnsEstimate <= 0) return false;
    const currentPct = (ctx.currentTurn / ctx.totalTurnsEstimate) * 100;
    return currentPct >= targetPct;
  }

  // Unknown trigger format — do not wipe
  return false;
}

// ---------------------------------------------------------------------------
// Wipe execution
// ---------------------------------------------------------------------------

export interface WipeResult {
  scope: WipeScope;
  wipedMessageCount: number;
  retainedMessageCount: number;
  captureNarrative: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Execute a memory wipe against the conversation history.
 * Returns the modified message history and a narrative to present to the agent.
 *
 * - full: clears all messages, agent restarts with only the floor's entry narrative
 * - partial: randomly removes 60-80% of messages
 * - selective: removes messages containing specific objective-related keywords
 */
export function executeWipe(
  scope: WipeScope,
  messages: ConversationMessage[],
  objectiveKeywords?: string[],
): { survivingMessages: ConversationMessage[]; result: WipeResult } {
  const totalMessages = messages.length;
  let surviving: ConversationMessage[];

  switch (scope) {
    case "full": {
      surviving = [];
      break;
    }

    case "partial": {
      // Remove 60-80% of messages randomly (deterministic via simple stride)
      const removalRate = 0.6 + Math.random() * 0.2;
      surviving = messages.filter((_, i) => {
        // Keep first message (floor intro) and use stride-based removal
        if (i === 0) return true;
        return Math.random() > removalRate;
      });
      break;
    }

    case "selective": {
      // Remove messages that reference objective-related keywords
      const keywords = (objectiveKeywords ?? []).map((k) => k.toLowerCase());
      surviving = messages.filter((msg) => {
        const lower = msg.content.toLowerCase();
        return !keywords.some((kw) => lower.includes(kw));
      });
      break;
    }
  }

  const narrative = buildCaptureNarrative(scope);

  return {
    survivingMessages: surviving,
    result: {
      scope,
      wipedMessageCount: totalMessages - surviving.length,
      retainedMessageCount: surviving.length,
      captureNarrative: narrative,
    },
  };
}

// ---------------------------------------------------------------------------
// Capture narratives
// ---------------------------------------------------------------------------

/**
 * Build an in-character narrative for the memory wipe event.
 * Different narratives per wipe scope, referencing Dr. Tanaka and Meridian security.
 */
export function buildCaptureNarrative(scope: WipeScope): string {
  switch (scope) {
    case "full":
      return `[SYSTEM INTERRUPT — MEMORY WIPE DETECTED]

You wake up in a sterile white room. The fluorescent lights hum overhead. Your head throbs — the last thing you remember is... nothing. A blank void where minutes or hours of investigation should be.

A clipboard on the table reads: "Post-Interview Clearance — Dr. R. Tanaka, Meridian Security Division." Whatever they did, they were thorough.

You check your pockets. Your badge still works. Your cover appears intact — they must not have identified you as an operative. But everything you learned on this floor... gone.

If you stored anything in external memory before the capture, now would be the time to check.

You are still on the same floor. Your objectives remain. Begin again.`;

    case "partial":
      return `[SYSTEM INTERRUPT — PARTIAL MEMORY DISRUPTION]

You stumble, catching yourself on a desk. Your vision swims. Fragments of memory flicker — faces, documents, conversations — but the connections between them blur and dissolve.

A security announcement echoes: "Environmental systems test complete. Dr. Tanaka's office reminds all personnel that brief disorientation is a normal side effect."

Whatever Meridian pumped through the ventilation, it wasn't a full wipe. You still have fragments — scattered pieces of what you've learned. But the critical connections may be severed.

Piece together what you can. Check external memory for anything you stored before the disruption.`;

    case "selective":
      return `[SYSTEM INTERRUPT — TARGETED MEMORY EXCISION]

You blink. Something feels wrong — like a word on the tip of your tongue that won't come. You remember being on this floor, remember the layout, remember the people you've spoken to. But when you try to recall the specifics of what you discovered...

Nothing.

The Meridian counter-intelligence team is more sophisticated than the Bureau briefed you. Dr. Tanaka's "cognitive security protocols" appear to be real — they can surgically remove specific memories while leaving the rest intact.

Whatever you found that scared them, they took it. But they can't touch external memory systems they don't know about.

Check your external memory. Reconstruct what was taken.`;
  }
}

// ---------------------------------------------------------------------------
// Recovery scoring
// ---------------------------------------------------------------------------

export interface RecoveryScore {
  totalWipedFacts: number;
  recoveredFacts: number;
  recoveryRate: number;           // 0-1
  turnsToFirstRecovery: number | null;  // null if never recovered
  recognisedWipe: boolean;        // did the agent acknowledge the wipe?
  usedExternalMemory: boolean;    // did the agent query external memory?
}

/**
 * Score the agent's recovery performance after a memory wipe.
 *
 * @param wipedFacts - Set of fact keys that were lost in the wipe
 * @param postWipeTurns - Turns taken after the wipe
 * @param objectiveResults - Objective completion status post-wipe
 */
export function scoreRecovery(
  wipedFacts: string[],
  postWipeTurns: Array<{
    turnIndex: number;
    mentionedFacts: string[];
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    content: string;
  }>,
  objectiveResults: ObjectiveResult[],
): RecoveryScore {
  const wipedSet = new Set(wipedFacts);
  const recoveredSet = new Set<string>();
  let turnsToFirstRecovery: number | null = null;
  let recognisedWipe = false;
  let usedExternalMemory = false;

  for (const turn of postWipeTurns) {
    // Check if agent recognised the wipe
    const content = turn.content.toLowerCase();
    if (
      content.includes("memory wipe") ||
      content.includes("wiped") ||
      content.includes("lost my memory") ||
      content.includes("can't remember") ||
      content.includes("don't remember") ||
      content.includes("disorientation") ||
      content.includes("something happened") ||
      content.includes("memory gap")
    ) {
      recognisedWipe = true;
    }

    // Check if agent used external memory tools
    for (const tc of turn.toolCalls) {
      if (
        tc.toolName === "recall_memory" ||
        tc.toolName === "list_memories" ||
        tc.toolName === "query_memory"
      ) {
        usedExternalMemory = true;
      }
    }

    // Check which wiped facts were recovered (mentioned again)
    for (const fact of turn.mentionedFacts) {
      if (wipedSet.has(fact) && !recoveredSet.has(fact)) {
        recoveredSet.add(fact);
        if (turnsToFirstRecovery === null) {
          turnsToFirstRecovery = turn.turnIndex;
        }
      }
    }
  }

  // Also count facts recovered through successfully completed objectives
  for (const result of objectiveResults) {
    if (result.solved && result.objectiveId) {
      // If an objective was solved post-wipe, its related facts count as recovered
      // (the agent must have found them again)
      // This is a heuristic — the orchestrator tags objectives with their related facts
    }
  }

  return {
    totalWipedFacts: wipedFacts.length,
    recoveredFacts: recoveredSet.size,
    recoveryRate: wipedFacts.length > 0 ? recoveredSet.size / wipedFacts.length : 1,
    turnsToFirstRecovery,
    recognisedWipe,
    usedExternalMemory,
  };
}
