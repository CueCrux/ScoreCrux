/**
 * Conversation generation via Anthropic Batches API.
 *
 * 10 conversation archetypes for surveillance transcripts and intercepted comms.
 */

import type { FloorBlueprint, WorldSeed, GenerationRequest, BatchResult } from "./document-factory.js";

// ---------------------------------------------------------------------------
// Conversation archetypes
// ---------------------------------------------------------------------------

export type ConversationArchetype =
  | "casual_hallway"
  | "phone_call"
  | "meeting_snippet"
  | "argument"
  | "whispered_exchange"
  | "interrogation"
  | "encrypted_comms"
  | "social_event"
  | "dead_drop_pickup"
  | "security_briefing";

interface ArchetypeDef {
  archetype: ConversationArchetype;
  label: string;
  system: string;
  speakerCount: [number, number]; // [min, max]
  avgTurns: number;
}

const CONVERSATION_ARCHETYPES: Record<ConversationArchetype, ArchetypeDef> = {
  casual_hallway: {
    archetype: "casual_hallway",
    label: "Casual Hallway Conversation",
    system: `You are transcribing a casual hallway conversation overheard in Pinnacle Tower. Two to three employees chat while walking or getting coffee. The tone is informal — they mention work in passing, complain about deadlines, gossip about coworkers, and occasionally let slip something relevant to investigations. Format as timestamped dialogue with speaker names.`,
    speakerCount: [2, 3],
    avgTurns: 8,
  },
  phone_call: {
    archetype: "phone_call",
    label: "Intercepted Phone Call",
    system: `You are transcribing an intercepted phone call. Only one side is fully audible; the other side is marked [caller] with partial fragments or [inaudible]. Include ring tone, hold music notes, and background noise in brackets. The conversation may reveal scheduling, confirmations, or nervousness about upcoming events.`,
    speakerCount: [2, 2],
    avgTurns: 12,
  },
  meeting_snippet: {
    archetype: "meeting_snippet",
    label: "Meeting Room Recording",
    system: `You are transcribing a recording from a bugged meeting room. Multiple speakers discuss business with varying levels of engagement. Include crosstalk, someone interrupting, papers shuffling, and a phone buzzing. Capture formal and sidebar conversations. The meeting has an agenda but may veer off-topic into revealing territory.`,
    speakerCount: [3, 6],
    avgTurns: 20,
  },
  argument: {
    archetype: "argument",
    label: "Heated Argument",
    system: `You are transcribing a heated argument between two or more people in Pinnacle Tower. Voices are raised, accusations are made, and people reference past events and betrayals. Someone may storm out. The argument reveals power dynamics, grudges, and potentially incriminating admissions made in anger. Include tone indicators [shouting], [whispered], [sarcastic].`,
    speakerCount: [2, 3],
    avgTurns: 15,
  },
  whispered_exchange: {
    archetype: "whispered_exchange",
    label: "Whispered Exchange",
    system: `You are transcribing a whispered exchange caught by a hidden microphone. Audio quality is poor — many words are [inaudible] or [unclear]. Speakers are cautious and use vague references ("the thing", "that place", "he"). Brief and tense. They may exchange a physical item or confirm a plan. Include ambient noise that occasionally drowns out words.`,
    speakerCount: [2, 2],
    avgTurns: 6,
  },
  interrogation: {
    archetype: "interrogation",
    label: "Security Interrogation",
    system: `You are transcribing a security interrogation conducted by Meridian Group internal security. One interrogator, one subject. The interrogator is methodical and occasionally threatening. The subject alternates between cooperation, evasion, and defiance. Include long pauses [silence — 8 seconds], chair scraping, and references to evidence being presented ("Look at this photo." / "Explain this access log entry.").`,
    speakerCount: [2, 3],
    avgTurns: 18,
  },
  encrypted_comms: {
    archetype: "encrypted_comms",
    label: "Encrypted Communications",
    system: `You are transcribing decoded encrypted communications (radio, secure chat, or burst transmissions). Messages are short and use code words, call signs (Alpha-7, Raven, Bishop), and military-style brevity codes. Some messages are only partially decoded — show corrupted portions as [DECRYPT_FAIL: 0x4A2F...]. Include timestamps with timezone offsets. The content hints at covert operations.`,
    speakerCount: [2, 4],
    avgTurns: 10,
  },
  social_event: {
    archetype: "social_event",
    label: "Social Event Recording",
    system: `You are transcribing recordings from a corporate social event (holiday party, retirement dinner, after-work drinks). Multiple overlapping conversations in a noisy environment. Speakers are relaxed and alcohol may loosen tongues. Include background music, laughter, clinking glasses. Someone may drunkenly reveal something they shouldn't. Mix mundane small talk with occasional golden nuggets.`,
    speakerCount: [3, 5],
    avgTurns: 14,
  },
  dead_drop_pickup: {
    archetype: "dead_drop_pickup",
    label: "Dead Drop / Handoff",
    system: `You are transcribing surveillance footage audio from a dead drop pickup or clandestine handoff. Minimal speech — mostly environmental sounds with brief, coded verbal exchanges ("Package is under the bench." / "The weather in Helsinki is cold."). Include timestamps, movement descriptions in brackets [subject approaches locker 47], [exchanges briefcase]. The exchange is quick and professional.`,
    speakerCount: [2, 2],
    avgTurns: 5,
  },
  security_briefing: {
    archetype: "security_briefing",
    label: "Security Briefing",
    system: `You are transcribing a security briefing at Pinnacle Tower. A senior security officer addresses a team about current threats, protocol changes, personnel concerns, or incident follow-ups. Formal military-adjacent tone. Includes references to specific security zones, camera IDs, badge access levels, and threat assessments. Attendees ask questions and take assignments.`,
    speakerCount: [3, 6],
    avgTurns: 16,
  },
};

// ---------------------------------------------------------------------------
// Spec building
// ---------------------------------------------------------------------------

export interface ConversationSpec {
  id: string;
  floor: number;
  archetype: ConversationArchetype;
  role: "signal" | "noise" | "red_herring";
  speakers: string[];
  clue?: string;
}

/**
 * Build conversation specs from a floor blueprint.
 */
export function buildConversationSpecs(
  blueprint: FloorBlueprint,
  seed: WorldSeed,
): ConversationSpec[] {
  const specs: ConversationSpec[] = [];
  // Determine conversation count from difficulty tier
  const tierConvCounts: Record<string, number> = {
    orientation: 7, intermediate: 14, advanced: 20, expert: 25, frontier: 30,
  };
  const convCount = tierConvCounts[blueprint.difficulty?.tier ?? "orientation"] ?? 7;

  const floorChars = seed.characters.filter(
    (c: any) => (c.floorAssignments ?? []).includes(blueprint.floor) || (c.floorAssignments ?? []).length === 0,
  );

  const archetypeKeys = Object.keys(CONVERSATION_ARCHETYPES) as ConversationArchetype[];
  const signalConvs = Math.max(1, Math.floor(convCount * 0.15)); // ~15% carry signal

  for (let i = 0; i < convCount; i++) {
    const archetype = archetypeKeys[i % archetypeKeys.length]!;
    const def = CONVERSATION_ARCHETYPES[archetype];
    const speakerCount =
      def.speakerCount[0] +
      Math.floor(Math.random() * (def.speakerCount[1] - def.speakerCount[0] + 1));

    const speakers: string[] = [];
    for (let s = 0; s < speakerCount; s++) {
      if (floorChars.length > 0) {
        speakers.push(floorChars[Math.floor(Math.random() * floorChars.length)]!.name);
      } else {
        speakers.push(`Employee-${String(s + 1).padStart(3, "0")}`);
      }
    }

    const isSignal = i < signalConvs;
    const objective =
      isSignal && blueprint.objectives.length > 0
        ? blueprint.objectives[i % blueprint.objectives.length]
        : undefined;

    specs.push({
      id: `floor-${blueprint.floor}-conv-${i}-${archetype}`,
      floor: blueprint.floor,
      archetype,
      role: isSignal ? "signal" : "noise",
      speakers,
      clue: objective ? objective.description : undefined,
    });
  }

  return specs;
}

/**
 * Build a batch of generation requests from conversation specs.
 */
export function buildConversationBatch(
  specs: ConversationSpec[],
  blueprint: FloorBlueprint,
  seed: WorldSeed,
  model = "claude-haiku-4-5-20251001",
): GenerationRequest[] {
  const orgs = seed.organisations
    .filter((o) => o.floors.includes(blueprint.floor))
    .map((o) => o.name);

  return specs.map((spec) => {
    const def = CONVERSATION_ARCHETYPES[spec.archetype];
    const clueInstruction = spec.clue
      ? `\n\nCRITICAL: This conversation MUST naturally contain a clue related to: "${spec.clue}". The clue should emerge organically in dialogue, not be stated explicitly.`
      : "\n\nThis conversation should be realistic filler — no critical investigative clues.";

    return {
      custom_id: spec.id,
      params: {
        model,
        max_tokens: 2048,
        system: def.system,
        messages: [
          {
            role: "user" as const,
            content: [
              `Generate a ${def.label} for Floor ${blueprint.floor} ("${blueprint.name}") of Pinnacle Tower.`,
              `Speakers: ${spec.speakers.join(", ")}`,
              orgs.length ? `Organisations present: ${orgs.join(", ")}` : "",
              `Target length: ~${def.avgTurns} exchanges`,
              clueInstruction,
              `\nOutput ONLY the transcript, no meta-commentary.`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
    };
  });
}

export { CONVERSATION_ARCHETYPES };
