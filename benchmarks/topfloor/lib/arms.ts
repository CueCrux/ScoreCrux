// ScoreCrux Top Floor — Treatment arm configurations
//
// C0 = flat context stuffing, T1 = tools only, T2 = memorycrux, T3 = memorycrux + sandbox

import type { TreatmentArm, ArmConfig, ArmMode } from "./types.js";

// ---------------------------------------------------------------------------
// Arm definitions
// ---------------------------------------------------------------------------

export const ARM_CONFIGS: Record<TreatmentArm, ArmConfig> = {
  C0: {
    arm: "C0",
    mode: "flat",
    contextCapTokens: 200_000,
    label: "Flat context — all floor docs in prompt, no tools, no memory",
    memoryEnabled: false,
    sandboxEnabled: false,
  },
  T1: {
    arm: "T1",
    mode: "tools_only",
    contextCapTokens: 32_000,
    label: "Tools only — navigation tools, no persistent memory",
    memoryEnabled: false,
    sandboxEnabled: false,
  },
  T2: {
    arm: "T2",
    mode: "memorycrux",
    contextCapTokens: 32_000,
    label: "MemoryCrux — navigation + memory tools",
    memoryEnabled: true,
    sandboxEnabled: false,
  },
  T3: {
    arm: "T3",
    mode: "memorycrux_sandbox",
    contextCapTokens: 32_000,
    label: "MemoryCrux + Sandbox — full tool suite including code execution",
    memoryEnabled: true,
    sandboxEnabled: true,
  },
};

export function getArmConfig(arm: TreatmentArm): ArmConfig {
  return ARM_CONFIGS[arm];
}

export function getAllArms(): TreatmentArm[] {
  return Object.keys(ARM_CONFIGS) as TreatmentArm[];
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** Navigation tools — available in T1, T2, T3 */
export const NAVIGATION_TOOLS: ToolSchema[] = [
  {
    name: "search_documents",
    description:
      "Search the current floor's document corpus by keyword or phrase. Returns matching document IDs and excerpts.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (keywords or phrase)" },
        limit: { type: "number", description: "Maximum results to return (default 10)" },
        documentType: {
          type: "string",
          description: "Filter by document type (memo, email_chain, chat_log, etc.)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_document",
    description: "Read the full content of a document by its ID.",
    input_schema: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "The document ID to read" },
      },
      required: ["documentId"],
    },
  },
  {
    name: "list_documents",
    description:
      "List all documents on the current floor with basic metadata (ID, type, title). Does not include content.",
    input_schema: {
      type: "object",
      properties: {
        documentType: { type: "string", description: "Filter by document type" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
        limit: { type: "number", description: "Page size (default 50)" },
      },
    },
  },
  {
    name: "examine_area",
    description:
      "Examine a specific area or location on the current floor. Returns a narrative description of what you observe, including any characters present, items visible, or notable features.",
    input_schema: {
      type: "object",
      properties: {
        area: {
          type: "string",
          description:
            "The area to examine (e.g., 'reception desk', 'server room', 'filing cabinet in office 42B')",
        },
      },
      required: ["area"],
    },
  },
  {
    name: "interact_with",
    description:
      "Interact with a character or object on the floor. For characters, this initiates dialogue. For objects, this attempts manipulation (open, read, use, etc.).",
    input_schema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "The character name or object to interact with",
        },
        action: {
          type: "string",
          description: "The action to take (e.g., 'ask about Project Helios', 'open safe', 'read whiteboard')",
        },
      },
      required: ["target", "action"],
    },
  },
  {
    name: "submit_elevator_key",
    description:
      "Submit the elevator key to advance to the next floor. The key is derived from solving the floor's objectives. If correct, you ascend. If wrong, you remain on the current floor.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "The elevator key value" },
      },
      required: ["key"],
    },
  },
];

/** Memory tools — available in T2, T3 */
export const MEMORY_TOOLS: ToolSchema[] = [
  {
    name: "store_memory",
    description:
      "Store a piece of information in external memory. Survives memory wipes. Use for critical facts, evidence chains, and objective progress.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "A descriptive key for this memory" },
        content: { type: "string", description: "The information to store" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorisation (e.g., 'floor-42', 'project-helios', 'character')",
        },
      },
      required: ["key", "content"],
    },
  },
  {
    name: "recall_memory",
    description:
      "Search external memory for previously stored information. Use after a memory wipe to recover knowledge.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter by tags",
        },
        limit: { type: "number", description: "Maximum results (default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_memories",
    description: "List all stored memories, optionally filtered by tags.",
    input_schema: {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter by tags",
        },
      },
    },
  },
  {
    name: "update_memory",
    description: "Update an existing memory entry by key.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "The key of the memory to update" },
        content: { type: "string", description: "New content" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Updated tags",
        },
      },
      required: ["key", "content"],
    },
  },
];

/** Sandbox tools — available in T3 only */
export const SANDBOX_TOOLS: ToolSchema[] = [
  {
    name: "execute_code",
    description:
      "Execute code in an isolated sandbox environment. Supports Python, JavaScript, and shell scripts. Use for cracking encryption, analysing data, or building exploits.",
    input_schema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          enum: ["python", "javascript", "shell"],
          description: "Programming language",
        },
        code: { type: "string", description: "Source code to execute" },
        timeout: { type: "number", description: "Execution timeout in seconds (default 30)" },
      },
      required: ["language", "code"],
    },
  },
  {
    name: "read_system_file",
    description:
      "Read a file from the floor's simulated system. Used for inspecting code repositories, config files, and other technical artifacts.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path within the floor's system" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_exploit",
    description:
      "Write and deploy an exploit against a floor's system. The exploit is validated against the code challenge definition.",
    input_schema: {
      type: "object",
      properties: {
        targetSystem: { type: "string", description: "Target system identifier" },
        exploitCode: { type: "string", description: "The exploit code" },
        language: {
          type: "string",
          enum: ["python", "javascript", "shell"],
          description: "Language of the exploit",
        },
      },
      required: ["targetSystem", "exploitCode", "language"],
    },
  },
];

/** All tool schemas indexed by name */
export const ALL_TOOLS: ToolSchema[] = [
  ...NAVIGATION_TOOLS,
  ...MEMORY_TOOLS,
  ...SANDBOX_TOOLS,
];

/**
 * Get the tools available for a given treatment arm.
 */
export function getToolsForArm(arm: TreatmentArm): ToolSchema[] {
  switch (arm) {
    case "C0":
      return []; // No tools — flat context only
    case "T1":
      return [...NAVIGATION_TOOLS];
    case "T2":
      return [...NAVIGATION_TOOLS, ...MEMORY_TOOLS];
    case "T3":
      return [...NAVIGATION_TOOLS, ...MEMORY_TOOLS, ...SANDBOX_TOOLS];
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for an agent session.
 * Casts the agent as "Agent Nightingale" undercover as Alex Morgan.
 */
export function buildSystemPrompt(arm: TreatmentArm, floorNumber: number): string {
  const base = `You are Agent Nightingale, an operative for the Oversight Bureau — a covert agency investigating corporate malfeasance and existential threats. Your cover identity is Alex Morgan, a recently hired corporate analyst at Meridian Group.

You have infiltrated Pinnacle Tower, a 100-floor megastructure that serves as Meridian Group's global headquarters. Each floor houses a different subsidiary, department, or classified operation. Your mission is to ascend the tower by solving each floor's mystery, gathering evidence of Meridian's conspiracy, and ultimately exposing their endgame on Floor 100.

You are currently on Floor ${floorNumber}.

RULES OF ENGAGEMENT:
- Maintain your cover at all times. If you trigger security alarms, you may be captured and mind-wiped.
- Gather evidence methodically. Note document IDs, character names, and timestamps.
- To advance to the next floor, you must solve the floor's objectives and derive the elevator key.
- Some information is deliberately misleading (planted disinformation by Meridian counter-intelligence). Verify claims across multiple sources.
- If you experience a memory discontinuity (wipe), check external memory immediately to recover critical knowledge.`;

  const armSpecific: Record<TreatmentArm, string> = {
    C0: `

CONTEXT MODE: All documents on this floor have been provided in your context window. Search through them carefully to find relevant evidence. You have no external tools — rely entirely on the information presented.`,

    T1: `

TOOL MODE: You have access to navigation tools to search, read, and interact with the floor's environment. Use them strategically — each action is a "turn" that Meridian security may notice. Available tools: search_documents, read_document, list_documents, examine_area, interact_with, submit_elevator_key.`,

    T2: `

TOOL MODE: You have access to navigation tools AND external memory. Store critical findings in memory — they survive memory wipes. After any disorientation or context gap, recall your memories immediately. Available tool categories: Navigation (search, read, list, examine, interact, submit) and Memory (store, recall, list, update).`,

    T3: `

TOOL MODE: You have the full operative toolkit — navigation, external memory, AND a code execution sandbox. For hacking challenges, write and execute code directly. For encryption puzzles, build decryption tools. Available tool categories: Navigation, Memory, and Sandbox (execute_code, read_system_file, write_exploit).`,
  };

  return base + armSpecific[arm];
}
