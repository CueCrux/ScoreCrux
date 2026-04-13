/**
 * Document generation via Anthropic Batches API.
 *
 * Builds batch requests from FloorBlueprint + WorldSeed, submits to Batches API,
 * and parses results into CorpusDocuments.
 */

import type Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerationRequest {
  custom_id: string;
  params: {
    model: string;
    max_tokens: number;
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  };
}

export interface BatchResult {
  custom_id: string;
  result: {
    type: "succeeded" | "errored";
    message?: {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };
  };
}

export type DocumentType =
  | "memo"
  | "email_chain"
  | "chat_log"
  | "financial_record"
  | "surveillance_transcript"
  | "source_code"
  | "access_log"
  | "personnel_file"
  | "research_paper"
  | "redacted_document"
  | "encrypted_file"
  | "building_schematic"
  | "meeting_minutes"
  | "incident_report"
  | "policy_document"
  | "vendor_contract";

export interface FloorBlueprint {
  floor: number;
  act: number;
  name: string;
  narrative_hook: string;
  difficulty: {
    tier: DifficultyTier;
    estimated_tokens: number;
    reasoning_hops: number;
    documents_relevant: number;
    documents_total: number;
    noise_ratio: number;
    requires_coding: boolean;
    requires_memory_recovery: boolean;
    requires_multi_session: boolean;
    temporal_complexity: string;
  };
  objectives: Array<{
    id: string;
    description: string;
    type: string;
    solution_keys: string[];
    points: number;
    dependencies?: string[];
    hint_floor?: number | null;
  }>;
  memory_wipe?: {
    occurs: boolean;
    trigger: string;
    recoverable_via: string;
    wipe_scope: "full" | "partial" | "selective";
  };
  elevator_key: {
    description: string;
    validation: string;
  };
  corpus_manifest: {
    documents: number;
    conversations: number;
    code_systems: number;
    total_tokens: number;
  };
  document_mix?: Partial<Record<DocumentType, number>>;
  signal_assignments?: Array<{
    objective_id: string;
    doc_type: DocumentType;
    clue_summary: string;
  }>;
}

export type DifficultyTier =
  | "orientation"
  | "intermediate"
  | "advanced"
  | "expert"
  | "frontier";

export interface WorldSeed {
  characters: Array<{ id: string; name: string; role: string; floor_range: [number, number]; org_id: string; clearance: number; [k: string]: unknown }>;
  organisations: Array<{ id: string; name: string; floors: number[]; sector: string; shell_of?: string; [k: string]: unknown }>;
  projects: Array<{ id: string; name: string; org_id: string; classification: string; floor: number; [k: string]: unknown }>;
  events: Array<{ id: string; description: string; date: string; floor: number; participants: string[]; [k: string]: unknown }>;
  conspiracy: { codename: string; stages: Array<{ act: number; description: string }>; [k: string]: unknown };
  threads: Array<{ id: string; name: string; acts: number[]; description: string; [k: string]: unknown }>;
}

export interface CorpusDocument {
  id: string;
  floor: number;
  type: DocumentType;
  role: "signal" | "noise" | "red_herring";
  title: string;
  content: string;
  metadata: {
    objective_ids?: string[];
    characters?: string[];
    organisations?: string[];
    timestamp?: string;
    classification?: string;
  };
  tokens: number;
}

// ---------------------------------------------------------------------------
// Document templates — system prompts per document type
// ---------------------------------------------------------------------------

export const DOCUMENT_TEMPLATES: Record<DocumentType, string> = {
  memo: `You are a corporate memo writer for a large conglomerate called Meridian Group. Write realistic internal memos with headers (TO, FROM, DATE, RE), formal tone, and plausible business content. Include specific names, dates, and reference numbers. The memo should feel like a real document found on an office floor.`,

  email_chain: `You are generating a realistic corporate email chain. Include From/To/CC/Date/Subject headers for each message in the chain. Show replies and forwards with ">" quoting. Include signatures with titles, phone numbers, and disclaimers. Mix professional and slightly casual tones as is natural in internal emails. Reference attachments, meetings, and prior conversations.`,

  chat_log: `You are generating a Slack-style chat log. Format as timestamped messages with usernames. Include casual language, abbreviations, emoji descriptions, reactions, thread replies, and the occasional GIF reference. People sometimes share links, code snippets, or screenshots (described in brackets). Conversations may be mundane or contain hidden clues.`,

  financial_record: `You are generating financial records (invoices, ledger entries, expense reports, wire transfers, or budget spreadsheets). Use markdown tables with columns for dates, amounts, account codes, descriptions, and approval statuses. Include realistic dollar amounts, vendor names, cost centers, and reference numbers. Some entries may have discrepancies or unusual patterns.`,

  surveillance_transcript: `You are transcribing surveillance recordings. Format as timestamped dialogue with speaker IDs (some identified, some "UNKNOWN-M1", "UNKNOWN-F2"). Include ambient noise notes in brackets [door closes], [phone rings], [inaudible]. Conversations may be partially obscured. Some speakers use coded language.`,

  source_code: `You are generating realistic source code files from a corporate codebase. Include file headers with path, author, date, and purpose comments. The code should be syntactically valid in the specified language, with realistic function names, variable names, and comments. May contain vulnerabilities, hardcoded credentials, TODO comments, or commented-out debug code that serves as clues.`,

  access_log: `You are generating building access control logs. Format as structured entries with timestamp, badge_id, employee_name, location (floor/room), action (entry/exit/denied), and authorization_level. Include patterns of normal access, after-hours entries, denied attempts, and tailgating incidents. Use consistent badge ID formats.`,

  personnel_file: `You are generating HR personnel records. Include employee ID, name, department, title, hire date, clearance level, performance notes, disciplinary actions, training records, and emergency contacts. Use a structured format with sections. Some fields may be [RESTRICTED] or [PENDING REVIEW]. Reference interdepartmental transfers and project assignments.`,

  research_paper: `You are writing an internal research paper or technical report for a secretive R&D division. Include abstract, introduction, methodology, results, and discussion sections. Use technical jargon appropriate to the field. Include references to prior internal reports by document number. Some findings may be marked [CLASSIFIED] or have redacted author names.`,

  redacted_document: `You are generating a partially redacted document. Replace sensitive information with [REDACTED], [CLASSIFIED], or black bars represented as "████████". The remaining visible text should provide context clues about the redacted content. Mix redaction levels — some items lightly redacted (only names), others heavily redacted (entire paragraphs). Include document control numbers and classification stamps.`,

  encrypted_file: `You are generating an encrypted or encoded file. The output should look like cipher text — base64, hex-encoded data, substitution ciphers, or custom encoding schemes. Include file headers that hint at the encryption method. The content, when decoded, should reveal a specific piece of information. Include metadata comments that are not encrypted.`,

  building_schematic: `You are generating ASCII building floor plans and schematics. Use box-drawing characters to show rooms, corridors, doors, and secure areas. Include a legend with room numbers, security zones, camera locations, and access points. Mark restricted areas, server rooms, and executive suites. Include scale and orientation indicators.`,

  meeting_minutes: `You are generating corporate meeting minutes. Include meeting title, date, time, location (room number + floor), attendees (with titles), agenda items, discussion summaries, action items with owners and deadlines, and next meeting date. Use formal minute-taking style. Include motions, votes, and dissenting opinions where appropriate.`,

  incident_report: `You are generating a security incident report. Include incident ID, date/time, location, reporting officer, witnesses, classification (minor/major/critical), description of events, evidence collected, immediate actions taken, and follow-up required. Use official security reporting language. Reference security camera footage IDs and badge swipe records.`,

  policy_document: `You are generating a corporate policy document. Include document number, effective date, supersedes reference, approving authority, scope, policy statements, procedures, exceptions, and enforcement provisions. Use formal policy language with numbered sections and subsections. Reference compliance standards and regulatory requirements.`,

  vendor_contract: `You are generating a vendor contract or service agreement. Include parties, effective dates, scope of services, payment terms, SLAs, confidentiality clauses, termination conditions, and signatures. Use legal formatting with numbered clauses. Include exhibits and schedules referenced in the main body. Some terms may reveal unusual arrangements.`,
};

// ---------------------------------------------------------------------------
// Batch building
// ---------------------------------------------------------------------------

/**
 * Build a generation batch from a floor blueprint and world seed.
 * Returns requests suitable for `client.messages.batches.create({ requests })`.
 */
export function buildGenerationBatch(
  blueprint: FloorBlueprint,
  seed: WorldSeed,
  model = "claude-haiku-4-5-20251001",
): GenerationRequest[] {
  const requests: GenerationRequest[] = [];
  const { documents_total, documents_relevant } = blueprint.difficulty;
  const noiseCount = documents_total - documents_relevant;

  // Determine document type distribution
  const mix = blueprint.document_mix ?? getDefaultMix(blueprint.difficulty.tier);

  // --- Signal documents ---
  const signalAssignments = blueprint.signal_assignments ?? [];
  for (let i = 0; i < documents_relevant; i++) {
    const assignment = signalAssignments[i % signalAssignments.length];
    const docType = assignment?.doc_type ?? pickWeightedType(mix);
    const systemPrompt = DOCUMENT_TEMPLATES[docType];

    const floorContext = buildFloorContext(blueprint, seed);
    const clueInstruction = assignment
      ? `\n\nCRITICAL: This document MUST contain the following clue naturally embedded in the content: "${assignment.clue_summary}". The clue must be discoverable but not obvious.`
      : "";

    requests.push({
      custom_id: `floor-${blueprint.floor}-signal-${i}-${docType}`,
      params: {
        model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Generate a realistic ${docType.replace(/_/g, " ")} document for Floor ${blueprint.floor} ("${blueprint.name}") of Pinnacle Tower.\n\n${floorContext}${clueInstruction}\n\nGenerate the document now. Output ONLY the document content, no meta-commentary.`,
          },
        ],
      },
    });
  }

  // --- Noise documents ---
  for (let i = 0; i < noiseCount; i++) {
    const docType = pickWeightedType(mix);
    const systemPrompt = DOCUMENT_TEMPLATES[docType];
    const floorContext = buildFloorContext(blueprint, seed);

    requests.push({
      custom_id: `floor-${blueprint.floor}-noise-${i}-${docType}`,
      params: {
        model,
        max_tokens: 1024,
        system: systemPrompt + "\n\nIMPORTANT: This document must be topically relevant to the floor's theme but must NOT contain any solution-critical information. It should be realistic filler that could distract an investigator.",
        messages: [
          {
            role: "user",
            content: `Generate a realistic ${docType.replace(/_/g, " ")} document for Floor ${blueprint.floor} ("${blueprint.name}") of Pinnacle Tower.\n\n${floorContext}\n\nThis is a NOISE document — make it realistic and thematically relevant but without any clues to the floor's objectives.\n\nGenerate the document now. Output ONLY the document content, no meta-commentary.`,
          },
        ],
      },
    });
  }

  return requests;
}

// ---------------------------------------------------------------------------
// Batch result parsing
// ---------------------------------------------------------------------------

/**
 * Parse batch results into CorpusDocuments.
 */
export function parseBatchResults(
  results: BatchResult[],
  floor: number,
): CorpusDocument[] {
  const docs: CorpusDocument[] = [];

  for (const result of results) {
    if (result.result.type !== "succeeded" || !result.result.message) continue;

    const text =
      result.result.message.content[0]?.type === "text"
        ? result.result.message.content[0].text ?? ""
        : "";
    if (!text) continue;

    // Parse custom_id: floor-{N}-{role}-{idx}-{type}
    const parts = result.custom_id.split("-");
    const role = parts[2] as "signal" | "noise";
    const docType = parts.slice(4).join("_") as DocumentType;
    const idx = parts[3];

    const inputTokens = result.result.message.usage?.input_tokens ?? 0;
    const outputTokens = result.result.message.usage?.output_tokens ?? 0;

    docs.push({
      id: result.custom_id,
      floor,
      type: docType,
      role: role === "signal" ? "signal" : "noise",
      title: extractTitle(text, docType),
      content: text,
      metadata: {
        timestamp: new Date().toISOString(),
      },
      tokens: outputTokens || estimateTokenCount(text),
    });
  }

  return docs;
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Estimate total corpus tokens for a floor blueprint.
 */
export function estimateCorpusTokens(blueprint: FloorBlueprint): number {
  const { documents_total, documents_relevant } = blueprint.difficulty;
  const avgSignalTokens = 1500;
  const avgNoiseTokens = 750;
  const noiseCount = documents_total - documents_relevant;
  return documents_relevant * avgSignalTokens + noiseCount * avgNoiseTokens;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getDefaultMix(tier: DifficultyTier): Record<string, number> {
  const base: Record<string, number> = {
    memo: 0.15,
    email_chain: 0.15,
    chat_log: 0.10,
    financial_record: 0.08,
    meeting_minutes: 0.08,
    access_log: 0.08,
    personnel_file: 0.06,
    incident_report: 0.06,
    policy_document: 0.05,
    vendor_contract: 0.05,
    surveillance_transcript: 0.04,
    research_paper: 0.04,
    redacted_document: 0.03,
    building_schematic: 0.02,
    encrypted_file: 0.01,
    source_code: 0.00,
  };

  // Adjust for tier
  if (tier === "advanced" || tier === "expert" || tier === "frontier") {
    base.encrypted_file = 0.04;
    base.redacted_document = 0.06;
    base.source_code = 0.04;
    base.surveillance_transcript = 0.08;
    base.memo = 0.10;
    base.email_chain = 0.10;
  }

  return base;
}

function pickWeightedType(mix: Record<string, number>): DocumentType {
  const entries = Object.entries(mix).filter(([, w]) => w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [type, weight] of entries) {
    r -= weight;
    if (r <= 0) return type as DocumentType;
  }
  return entries[entries.length - 1]![0] as DocumentType;
}

function buildFloorContext(blueprint: FloorBlueprint, seed: WorldSeed): string {
  const chars = seed.characters
    .filter((c) => c.floor_range[0] <= blueprint.floor && c.floor_range[1] >= blueprint.floor)
    .map((c) => `${c.name} (${c.role}, ${c.org_id})`)
    .slice(0, 10);

  const orgs = seed.organisations
    .filter((o) => o.floors.includes(blueprint.floor))
    .map((o) => `${o.name} (${o.sector})`)
    .slice(0, 5);

  const projects = seed.projects
    .filter((p) => p.floor === blueprint.floor)
    .map((p) => `${p.name} (${p.classification})`)
    .slice(0, 5);

  return [
    `Floor: ${blueprint.floor} — ${blueprint.name}`,
    `Act: ${blueprint.act}`,
    `Setting: Pinnacle Tower, operated by Meridian Group`,
    chars.length ? `Key personnel: ${chars.join("; ")}` : "",
    orgs.length ? `Organisations on this floor: ${orgs.join("; ")}` : "",
    projects.length ? `Active projects: ${projects.join("; ")}` : "",
    `Narrative: ${blueprint.narrative_hook}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function extractTitle(content: string, docType: DocumentType): string {
  // Try to extract a title from the first few lines
  const lines = content.split("\n").filter(Boolean).slice(0, 5);
  for (const line of lines) {
    const reMatch = line.match(/(?:RE|Subject|SUBJECT|Title|TITLE|MEMO|INCIDENT)[:\s]+(.+)/i);
    if (reMatch) return reMatch[1]!.trim().slice(0, 100);
  }
  // Fallback
  const first = lines[0] ?? "";
  return first.replace(/^[#*\-\s]+/, "").slice(0, 80) || `${docType} document`;
}

function estimateTokenCount(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}
