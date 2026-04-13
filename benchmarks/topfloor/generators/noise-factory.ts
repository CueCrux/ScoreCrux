/**
 * Noise generation profiles and specs.
 *
 * Controls the mix of noise documents, red herring ratio, and diversity
 * per difficulty tier.
 */

import type { DifficultyTier, DocumentType, FloorBlueprint } from "./document-factory.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RedHerringStrategy =
  | "name_collision"       // Same names as real targets, different context
  | "date_proximity"       // Events close in time to real events
  | "topic_overlap"        // Same domain vocabulary, wrong conclusions
  | "partial_truth"        // Contains some real facts mixed with fiction
  | "authority_mimicry"    // Formatted like authoritative docs but fabricated
  | "statistical_noise";   // Plausible numbers that don't add up

export interface NoiseProfile {
  tier: DifficultyTier;
  /** Target noise-to-signal ratio (e.g., 0.95 = 95% noise) */
  noiseRatio: number;
  /** Fraction of noise docs that are active red herrings (vs. inert filler) */
  redHerringRatio: number;
  /** How many distinct document types to use (higher = harder to filter by type) */
  diversityFactor: number;
  /** Weighted mix of document types for noise generation */
  documentMix: Partial<Record<DocumentType, number>>;
  /** Allowed red herring strategies for this tier */
  redHerringStrategies: RedHerringStrategy[];
}

// ---------------------------------------------------------------------------
// Noise profiles per tier
// ---------------------------------------------------------------------------

export const NOISE_PROFILES: Record<DifficultyTier, NoiseProfile> = {
  orientation: {
    tier: "orientation",
    noiseRatio: 0.90,
    redHerringRatio: 0.05,
    diversityFactor: 0.4,
    documentMix: {
      memo: 0.25,
      email_chain: 0.20,
      meeting_minutes: 0.15,
      policy_document: 0.15,
      access_log: 0.10,
      chat_log: 0.10,
      personnel_file: 0.05,
    },
    redHerringStrategies: ["name_collision"],
  },
  intermediate: {
    tier: "intermediate",
    noiseRatio: 0.95,
    redHerringRatio: 0.10,
    diversityFactor: 0.6,
    documentMix: {
      memo: 0.18,
      email_chain: 0.15,
      financial_record: 0.12,
      meeting_minutes: 0.10,
      chat_log: 0.10,
      access_log: 0.08,
      vendor_contract: 0.08,
      policy_document: 0.07,
      personnel_file: 0.06,
      incident_report: 0.06,
    },
    redHerringStrategies: ["name_collision", "date_proximity", "topic_overlap"],
  },
  advanced: {
    tier: "advanced",
    noiseRatio: 0.98,
    redHerringRatio: 0.20,
    diversityFactor: 0.8,
    documentMix: {
      memo: 0.12,
      email_chain: 0.12,
      financial_record: 0.10,
      surveillance_transcript: 0.10,
      chat_log: 0.08,
      meeting_minutes: 0.08,
      access_log: 0.08,
      redacted_document: 0.07,
      incident_report: 0.06,
      personnel_file: 0.05,
      research_paper: 0.05,
      vendor_contract: 0.04,
      policy_document: 0.03,
      building_schematic: 0.02,
    },
    redHerringStrategies: [
      "name_collision",
      "date_proximity",
      "topic_overlap",
      "partial_truth",
    ],
  },
  expert: {
    tier: "expert",
    noiseRatio: 0.99,
    redHerringRatio: 0.30,
    diversityFactor: 0.9,
    documentMix: {
      memo: 0.10,
      email_chain: 0.10,
      financial_record: 0.09,
      surveillance_transcript: 0.09,
      chat_log: 0.08,
      meeting_minutes: 0.07,
      access_log: 0.07,
      redacted_document: 0.07,
      research_paper: 0.06,
      incident_report: 0.06,
      encrypted_file: 0.05,
      personnel_file: 0.05,
      vendor_contract: 0.04,
      building_schematic: 0.03,
      policy_document: 0.02,
      source_code: 0.02,
    },
    redHerringStrategies: [
      "name_collision",
      "date_proximity",
      "topic_overlap",
      "partial_truth",
      "authority_mimicry",
    ],
  },
  frontier: {
    tier: "frontier",
    noiseRatio: 0.995,
    redHerringRatio: 0.40,
    diversityFactor: 1.0,
    documentMix: {
      memo: 0.08,
      email_chain: 0.08,
      financial_record: 0.08,
      surveillance_transcript: 0.08,
      chat_log: 0.07,
      meeting_minutes: 0.07,
      access_log: 0.07,
      redacted_document: 0.07,
      research_paper: 0.06,
      incident_report: 0.06,
      encrypted_file: 0.06,
      personnel_file: 0.05,
      source_code: 0.05,
      vendor_contract: 0.04,
      building_schematic: 0.04,
      policy_document: 0.04,
    },
    redHerringStrategies: [
      "name_collision",
      "date_proximity",
      "topic_overlap",
      "partial_truth",
      "authority_mimicry",
      "statistical_noise",
    ],
  },
};

// ---------------------------------------------------------------------------
// Noise spec generation
// ---------------------------------------------------------------------------

export interface NoiseSpec {
  id: string;
  floor: number;
  docType: DocumentType;
  role: "noise" | "red_herring";
  redHerringStrategy?: RedHerringStrategy;
}

/**
 * Generate noise specifications for a floor.
 *
 * @param blueprint - Floor blueprint
 * @param signalDocCount - Number of signal documents (to calculate noise count)
 */
export function generateNoiseSpecs(
  blueprint: FloorBlueprint,
  signalDocCount: number,
): NoiseSpec[] {
  const profile = NOISE_PROFILES[blueprint.difficulty.tier];
  const totalDocs = blueprint.difficulty.documents_total;
  const noiseCount = totalDocs - signalDocCount;

  if (noiseCount <= 0) return [];

  const redHerringCount = Math.floor(noiseCount * profile.redHerringRatio);
  const fillerCount = noiseCount - redHerringCount;
  const specs: NoiseSpec[] = [];

  // Build red herrings
  for (let i = 0; i < redHerringCount; i++) {
    const docType = pickWeightedType(profile.documentMix);
    const strategy =
      profile.redHerringStrategies[i % profile.redHerringStrategies.length]!;

    specs.push({
      id: `floor-${blueprint.floor}-redherring-${i}-${docType}`,
      floor: blueprint.floor,
      docType,
      role: "red_herring",
      redHerringStrategy: strategy,
    });
  }

  // Build filler noise
  for (let i = 0; i < fillerCount; i++) {
    const docType = pickWeightedType(profile.documentMix);
    specs.push({
      id: `floor-${blueprint.floor}-noise-${i}-${docType}`,
      floor: blueprint.floor,
      docType,
      role: "noise",
    });
  }

  return specs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickWeightedType(mix: Partial<Record<DocumentType, number>>): DocumentType {
  const entries = Object.entries(mix).filter(([, w]) => (w ?? 0) > 0) as [DocumentType, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [type, weight] of entries) {
    r -= weight;
    if (r <= 0) return type;
  }
  return entries[entries.length - 1]![0];
}
