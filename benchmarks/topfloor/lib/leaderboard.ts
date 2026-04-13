/**
 * ScoreCrux Top Floor — Leaderboard System
 *
 * Aggregates player progress into ranked leaderboards.
 * Multiple views: overall, per-model, per-floor, speedrun.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PlayerProfile } from "./player.js";
import { toPublicProfile, type PublicProfile } from "./player.js";
import type { SaveState } from "./save-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  rank: number;
  player: PublicProfile;
  /** Highest floor cleared */
  highestFloor: number;
  /** Total points earned (best per floor) */
  totalPoints: number;
  /** Floors cleared count */
  floorsCleared: number;
  /** Model used */
  model: string;
  /** Treatment arm */
  arm: string;
  /** Total turns across all best floor results */
  totalTurns: number;
  /** Total tokens consumed */
  totalTokens: number;
  /** Total play time */
  totalDurationMs: number;
  /** Number of memory wipes survived */
  wipesExperienced: number;
  /** Number of floor revisits */
  revisits: number;
  /** When last played */
  lastPlayedAt: string;
}

export type LeaderboardSort =
  | "highest_floor"    // default: who got furthest
  | "total_points"     // most points (including partial credit)
  | "speedrun"         // fewest turns to reach highest floor
  | "efficiency"       // best points-per-token ratio
  | "most_floors";     // most floors cleared (regardless of how high)

export interface LeaderboardFilter {
  model?: string;
  arm?: string;
  minFloor?: number;
  maxFloor?: number;
}

export interface Leaderboard {
  entries: LeaderboardEntry[];
  generatedAt: string;
  filter: LeaderboardFilter;
  sort: LeaderboardSort;
  totalPlayers: number;
}

// ---------------------------------------------------------------------------
// Leaderboard Construction
// ---------------------------------------------------------------------------

/**
 * Build the leaderboard from all players and their save states.
 */
export function buildLeaderboard(
  dataDir: string,
  sort: LeaderboardSort = "highest_floor",
  filter: LeaderboardFilter = {},
  limit: number = 100,
): Leaderboard {
  // Load all players
  const playersDir = join(dataDir, "players");
  const savesDir = join(dataDir, "saves");
  if (!existsSync(playersDir)) {
    return { entries: [], generatedAt: new Date().toISOString(), filter, sort, totalPlayers: 0 };
  }

  const playerFiles = readdirSync(playersDir).filter((f) => f.endsWith(".json"));
  const entries: LeaderboardEntry[] = [];

  for (const file of playerFiles) {
    const player = JSON.parse(readFileSync(join(playersDir, file), "utf-8")) as PlayerProfile;

    // Skip players who opted out of public leaderboard
    if (!player.preferences.publicLeaderboard) continue;

    // Find the player's best save
    const bestSave = findBestSave(player, savesDir, filter);
    if (!bestSave) continue;

    // Apply filters
    if (filter.model && bestSave.model !== filter.model) continue;
    if (filter.arm && bestSave.arm !== filter.arm) continue;
    if (filter.minFloor && bestSave.highestFloorCleared < filter.minFloor) continue;
    if (filter.maxFloor && bestSave.highestFloorCleared > filter.maxFloor) continue;

    entries.push({
      rank: 0, // set after sorting
      player: toPublicProfile(player),
      highestFloor: bestSave.highestFloorCleared,
      totalPoints: computeTotalPoints(bestSave),
      floorsCleared: Object.values(bestSave.bestPerFloor).filter((f) => f.elevatorKeyObtained).length,
      model: bestSave.model,
      arm: bestSave.arm,
      totalTurns: bestSave.stats.totalTurns,
      totalTokens: bestSave.stats.totalTokens,
      totalDurationMs: bestSave.stats.totalDurationMs,
      wipesExperienced: bestSave.stats.wipesExperienced,
      revisits: bestSave.stats.revisitCount,
      lastPlayedAt: bestSave.updatedAt,
    });
  }

  // Sort
  sortEntries(entries, sort);

  // Assign ranks
  for (let i = 0; i < entries.length; i++) {
    entries[i].rank = i + 1;
  }

  return {
    entries: entries.slice(0, limit),
    generatedAt: new Date().toISOString(),
    filter,
    sort,
    totalPlayers: entries.length,
  };
}

// ---------------------------------------------------------------------------
// Per-Floor Leaderboard
// ---------------------------------------------------------------------------

export interface FloorLeaderboardEntry {
  rank: number;
  player: PublicProfile;
  floor: number;
  objectivesSolved: number;
  objectivesTotal: number;
  elevatorKey: boolean;
  turnsUsed: number;
  tokensUsed: number;
  durationMs: number;
  visitCount: number;
  model: string;
}

export function buildFloorLeaderboard(
  floor: number,
  dataDir: string,
  limit: number = 50,
): FloorLeaderboardEntry[] {
  const playersDir = join(dataDir, "players");
  const savesDir = join(dataDir, "saves");
  if (!existsSync(playersDir) || !existsSync(savesDir)) return [];

  const entries: FloorLeaderboardEntry[] = [];
  const playerFiles = readdirSync(playersDir).filter((f) => f.endsWith(".json"));

  for (const file of playerFiles) {
    const player = JSON.parse(readFileSync(join(playersDir, file), "utf-8")) as PlayerProfile;
    if (!player.preferences.publicLeaderboard) continue;

    for (const saveId of player.saveIds) {
      const savePath = join(savesDir, `${saveId}.json`);
      if (!existsSync(savePath)) continue;

      const save = JSON.parse(readFileSync(savePath, "utf-8")) as SaveState;
      const best = save.bestPerFloor[floor];
      if (!best) continue;

      entries.push({
        rank: 0,
        player: toPublicProfile(player),
        floor,
        objectivesSolved: best.objectives.filter((o) => o.solved).length,
        objectivesTotal: best.objectives.length,
        elevatorKey: best.elevatorKeyObtained,
        turnsUsed: best.turnsUsed,
        tokensUsed: best.tokensUsed,
        durationMs: best.durationMs,
        visitCount: best.visitCount,
        model: save.model,
      });
    }
  }

  // Sort: key obtained first, then by fewest turns
  entries.sort((a, b) => {
    if (a.elevatorKey !== b.elevatorKey) return a.elevatorKey ? -1 : 1;
    if (a.objectivesSolved !== b.objectivesSolved) return b.objectivesSolved - a.objectivesSolved;
    return a.turnsUsed - b.turnsUsed;
  });

  for (let i = 0; i < entries.length; i++) entries[i].rank = i + 1;
  return entries.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findBestSave(
  player: PlayerProfile,
  savesDir: string,
  filter: LeaderboardFilter,
): SaveState | null {
  if (!existsSync(savesDir)) return null;

  let best: SaveState | null = null;
  for (const saveId of player.saveIds) {
    const savePath = join(savesDir, `${saveId}.json`);
    if (!existsSync(savePath)) continue;

    const save = JSON.parse(readFileSync(savePath, "utf-8")) as SaveState;
    if (filter.model && save.model !== filter.model) continue;
    if (filter.arm && save.arm !== filter.arm) continue;

    if (!best || save.highestFloorCleared > best.highestFloorCleared) {
      best = save;
    }
  }
  return best;
}

function computeTotalPoints(save: SaveState): number {
  let total = 0;
  for (const progress of Object.values(save.bestPerFloor)) {
    for (const obj of progress.objectives) {
      if (obj.solved) {
        total += 1; // simplified — would use actual point values from manifest
      }
    }
  }
  return total;
}

function sortEntries(entries: LeaderboardEntry[], sort: LeaderboardSort): void {
  switch (sort) {
    case "highest_floor":
      entries.sort((a, b) => {
        if (b.highestFloor !== a.highestFloor) return b.highestFloor - a.highestFloor;
        return b.totalPoints - a.totalPoints;
      });
      break;
    case "total_points":
      entries.sort((a, b) => b.totalPoints - a.totalPoints);
      break;
    case "speedrun":
      entries.sort((a, b) => {
        if (b.highestFloor !== a.highestFloor) return b.highestFloor - a.highestFloor;
        return a.totalTurns - b.totalTurns; // fewer turns = better
      });
      break;
    case "efficiency":
      entries.sort((a, b) => {
        const effA = a.totalTokens > 0 ? a.totalPoints / a.totalTokens : 0;
        const effB = b.totalTokens > 0 ? b.totalPoints / b.totalTokens : 0;
        return effB - effA;
      });
      break;
    case "most_floors":
      entries.sort((a, b) => b.floorsCleared - a.floorsCleared);
      break;
  }
}

// ---------------------------------------------------------------------------
// Formatted Output
// ---------------------------------------------------------------------------

export function formatLeaderboard(lb: Leaderboard): string {
  if (lb.entries.length === 0) return "No entries yet. Be the first to play!";

  const lines: string[] = [];
  lines.push("╔════╦══════════════════════════╦═══════╦════════╦═══════╦══════════╗");
  lines.push("║ #  ║ Player                   ║ Floor ║ Points ║ Turns ║ Model    ║");
  lines.push("╠════╬══════════════════════════╬═══════╬════════╬═══════╬══════════╣");

  for (const e of lb.entries) {
    const alias = e.player.alias.padEnd(24).slice(0, 24);
    const badge = e.player.tier === "linked" ? "🔗" : e.player.tier === "claimed" ? "✓" : " ";
    lines.push(
      `║ ${String(e.rank).padStart(2)} ║ ${badge}${alias}║ ${String(e.highestFloor).padStart(5)} ║ ${String(e.totalPoints).padStart(6)} ║ ${String(e.totalTurns).padStart(5)} ║ ${e.model.slice(-8).padEnd(8)} ║`,
    );
  }

  lines.push("╚════╩══════════════════════════╩═══════╩════════╩═══════╩══════════╝");
  lines.push(`${lb.totalPlayers} players | Generated ${lb.generatedAt}`);
  return lines.join("\n");
}
