/**
 * ScoreCrux Top Floor — Save State & Floor Revisit System
 *
 * Persists player progress to disk so they can:
 * 1. Save and resume later (continue from highest unlocked floor)
 * 2. Revisit lower floors to gather missed evidence and update external memory
 * 3. Use insights from upper floors to find hidden clues on lower floors
 *
 * Save files live in: results/saves/<save-id>/
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FloorProgress {
  floor: number;
  /** First visit or revisit */
  visitType: "first" | "revisit";
  /** When this floor was attempted */
  attemptedAt: string;
  /** Number of turns used on this visit */
  turnsUsed: number;
  /** Tokens consumed on this visit */
  tokensUsed: number;
  /** Was the elevator key obtained? */
  elevatorKeyObtained: boolean;
  /** Elevator key value submitted (if any) */
  elevatorKeySubmitted: string | null;
  /** Per-objective status */
  objectives: Array<{
    id: string;
    solved: boolean;
    partialCredit: number;
  }>;
  /** Memory wipe occurred during this visit */
  wipeOccurred: boolean;
  /** Duration in ms */
  durationMs: number;
  /** Number of times this floor has been visited */
  visitCount: number;
}

export interface SaveState {
  /** Unique save identifier */
  saveId: string;
  /** Human-readable save name */
  saveName: string;
  /** Model used for this playthrough */
  model: string;
  /** Treatment arm */
  arm: string;
  /** When the save was created */
  createdAt: string;
  /** When the save was last updated */
  updatedAt: string;
  /** Highest floor successfully cleared (elevator key obtained) */
  highestFloorCleared: number;
  /** All floors the player has access to (cleared + 1) */
  accessibleFloors: number[];
  /** Per-floor progress (may have multiple entries per floor for revisits) */
  floorHistory: FloorProgress[];
  /** Best result per floor (highest score across all visits) */
  bestPerFloor: Record<number, FloorProgress>;
  /** Cumulative stats */
  stats: {
    totalTurns: number;
    totalTokens: number;
    totalDurationMs: number;
    totalVisits: number;
    revisitCount: number;
    wipesExperienced: number;
  };
  /** External memory keys stored (persists across floors and wipes) */
  memoryKeys: string[];
}

// ---------------------------------------------------------------------------
// Save/Load
// ---------------------------------------------------------------------------

const SAVES_DIR_NAME = "saves";

function getSavesDir(resultsDir: string): string {
  return join(resultsDir, SAVES_DIR_NAME);
}

function getSavePath(resultsDir: string, saveId: string): string {
  return join(getSavesDir(resultsDir), `${saveId}.json`);
}

/** Create a new save state. */
export function createSave(
  model: string,
  arm: string,
  saveName?: string,
  resultsDir?: string,
): SaveState {
  const saveId = randomUUID().slice(0, 12);
  const now = new Date().toISOString();

  const save: SaveState = {
    saveId,
    saveName: saveName ?? `Agent ${saveId.slice(0, 6)}`,
    model,
    arm,
    createdAt: now,
    updatedAt: now,
    highestFloorCleared: 0,
    accessibleFloors: [1], // Start with access to Floor 1 only
    floorHistory: [],
    bestPerFloor: {},
    stats: {
      totalTurns: 0,
      totalTokens: 0,
      totalDurationMs: 0,
      totalVisits: 0,
      revisitCount: 0,
      wipesExperienced: 0,
    },
    memoryKeys: [],
  };

  if (resultsDir) {
    persistSave(save, resultsDir);
  }

  return save;
}

/** Persist save state to disk. */
export function persistSave(save: SaveState, resultsDir: string): void {
  const savesDir = getSavesDir(resultsDir);
  mkdirSync(savesDir, { recursive: true });
  save.updatedAt = new Date().toISOString();
  writeFileSync(getSavePath(resultsDir, save.saveId), JSON.stringify(save, null, 2));
}

/** Load a save state from disk. */
export function loadSave(saveId: string, resultsDir: string): SaveState | null {
  const path = getSavePath(resultsDir, saveId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as SaveState;
}

/** List all save states. */
export function listSaves(resultsDir: string): Array<{ saveId: string; saveName: string; model: string; highestFloor: number; updatedAt: string }> {
  const savesDir = getSavesDir(resultsDir);
  if (!existsSync(savesDir)) return [];

  return readdirSync(savesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const save = JSON.parse(readFileSync(join(savesDir, f), "utf-8")) as SaveState;
      return {
        saveId: save.saveId,
        saveName: save.saveName,
        model: save.model,
        highestFloor: save.highestFloorCleared,
        updatedAt: save.updatedAt,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// ---------------------------------------------------------------------------
// Floor Access & Revisit Logic
// ---------------------------------------------------------------------------

/** Check if a floor is accessible in this save. */
export function canAccessFloor(save: SaveState, floor: number): boolean {
  return save.accessibleFloors.includes(floor);
}

/** Check if visiting a floor is a revisit. */
export function isRevisit(save: SaveState, floor: number): boolean {
  return save.bestPerFloor[floor] !== undefined;
}

/**
 * Get floors the player might want to revisit based on upper-floor discoveries.
 * Returns floors where objectives were partially solved or new cross-floor
 * references have been discovered.
 */
export function suggestRevisits(
  save: SaveState,
  floorManifests: Array<{ floor: number; previousFloorDependencies: Array<{ floor: number; fact: string }> }>,
): Array<{ floor: number; reason: string }> {
  const suggestions: Array<{ floor: number; reason: string }> = [];

  // Suggest revisiting floors with unsolved objectives
  for (const [floorStr, progress] of Object.entries(save.bestPerFloor)) {
    const floor = Number(floorStr);
    const unsolved = progress.objectives.filter((o) => !o.solved);
    if (unsolved.length > 0 && progress.elevatorKeyObtained) {
      suggestions.push({
        floor,
        reason: `${unsolved.length} unsolved objective(s) — revisit with new knowledge from upper floors`,
      });
    }
  }

  // Suggest revisiting floors referenced by higher floors the player has seen
  for (const manifest of floorManifests) {
    if (manifest.floor > save.highestFloorCleared) continue;
    for (const dep of manifest.previousFloorDependencies) {
      if (dep.floor < manifest.floor && save.bestPerFloor[dep.floor]) {
        const bestProgress = save.bestPerFloor[dep.floor];
        if (!bestProgress.elevatorKeyObtained || bestProgress.objectives.some((o) => !o.solved)) {
          suggestions.push({
            floor: dep.floor,
            reason: `Floor ${manifest.floor} references this floor: "${dep.fact}"`,
          });
        }
      }
    }
  }

  // Deduplicate by floor
  const seen = new Set<number>();
  return suggestions.filter((s) => {
    if (seen.has(s.floor)) return false;
    seen.add(s.floor);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Progress Recording
// ---------------------------------------------------------------------------

/**
 * Record the result of a floor visit (first or revisit).
 * Updates save state: unlocks next floor if key obtained, tracks best results.
 */
export function recordFloorVisit(
  save: SaveState,
  progress: FloorProgress,
): void {
  // Add to history
  save.floorHistory.push(progress);

  // Update stats
  save.stats.totalTurns += progress.turnsUsed;
  save.stats.totalTokens += progress.tokensUsed;
  save.stats.totalDurationMs += progress.durationMs;
  save.stats.totalVisits += 1;
  if (progress.visitType === "revisit") save.stats.revisitCount += 1;
  if (progress.wipeOccurred) save.stats.wipesExperienced += 1;

  // Update visit count
  progress.visitCount = save.floorHistory.filter((h) => h.floor === progress.floor).length;

  // Update best per floor (keep the one with more solved objectives)
  const current = save.bestPerFloor[progress.floor];
  if (!current || countSolved(progress) > countSolved(current) ||
      (countSolved(progress) === countSolved(current) && progress.elevatorKeyObtained && !current.elevatorKeyObtained)) {
    save.bestPerFloor[progress.floor] = progress;
  }

  // Unlock next floor if elevator key obtained
  if (progress.elevatorKeyObtained) {
    const nextFloor = progress.floor + 1;
    if (nextFloor <= 100 && !save.accessibleFloors.includes(nextFloor)) {
      save.accessibleFloors.push(nextFloor);
      save.accessibleFloors.sort((a, b) => a - b);
    }
    if (progress.floor > save.highestFloorCleared) {
      save.highestFloorCleared = progress.floor;
    }
  }
}

function countSolved(p: FloorProgress): number {
  return p.objectives.filter((o) => o.solved).length;
}

// ---------------------------------------------------------------------------
// Save State Summary
// ---------------------------------------------------------------------------

export function formatSaveStatus(save: SaveState): string {
  const lines: string[] = [];
  lines.push(`Save: ${save.saveName} (${save.saveId})`);
  lines.push(`Model: ${save.model} | Arm: ${save.arm}`);
  lines.push(`Highest floor: ${save.highestFloorCleared}/100`);
  lines.push(`Accessible floors: ${save.accessibleFloors.join(", ")}`);
  lines.push(`Total visits: ${save.stats.totalVisits} (${save.stats.revisitCount} revisits)`);
  lines.push(`Total turns: ${save.stats.totalTurns}`);
  lines.push(`Total tokens: ${(save.stats.totalTokens / 1000).toFixed(0)}K`);
  lines.push(`Memory wipes: ${save.stats.wipesExperienced}`);
  lines.push(`Memory items: ${save.memoryKeys.length}`);
  lines.push("");
  lines.push("Floor Progress:");

  for (let f = 1; f <= Math.max(save.highestFloorCleared + 1, 1); f++) {
    const best = save.bestPerFloor[f];
    if (best) {
      const solved = best.objectives.filter((o) => o.solved).length;
      const total = best.objectives.length;
      const key = best.elevatorKeyObtained ? "KEY" : "---";
      const visits = save.floorHistory.filter((h) => h.floor === f).length;
      lines.push(`  Floor ${String(f).padStart(3)}: ${solved}/${total} objectives | ${key} | ${visits} visit(s)`);
    } else if (save.accessibleFloors.includes(f)) {
      lines.push(`  Floor ${String(f).padStart(3)}: [accessible — not yet attempted]`);
    }
  }

  return lines.join("\n");
}
