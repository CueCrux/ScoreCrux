/**
 * World seed query utilities.
 *
 * Provides filtered views into the world-seed.json for floor generation,
 * extracting characters, organisations, projects, events, and threads
 * relevant to a specific floor or act.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WorldSeed, FloorBlueprint } from "./document-factory.js";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const SEED_PATH = resolve(import.meta.dirname!, "../fixtures/world-seed.json");

let _cachedSeed: WorldSeed | null = null;

export function loadWorldSeed(path?: string): WorldSeed {
  if (_cachedSeed && !path) return _cachedSeed;
  const raw = readFileSync(path ?? SEED_PATH, "utf-8");
  const seed = JSON.parse(raw) as WorldSeed;
  if (!path) _cachedSeed = seed;
  return seed;
}

// ---------------------------------------------------------------------------
// Floor-scoped queries
// ---------------------------------------------------------------------------

/**
 * Characters assigned to or active on a given floor.
 */
export function getCharactersOnFloor(seed: WorldSeed, floor: number) {
  return seed.characters.filter(
    (c) => c.floor_range[0] <= floor && c.floor_range[1] >= floor,
  );
}

/**
 * Organisations with presence on a given floor.
 */
export function getOrganisationsOnFloor(seed: WorldSeed, floor: number) {
  return seed.organisations.filter((o) => o.floors.includes(floor));
}

/**
 * Projects assigned to a given floor.
 */
export function getProjectsOnFloor(seed: WorldSeed, floor: number) {
  return seed.projects.filter((p) => p.floor === floor);
}

/**
 * Events that take place on a given floor.
 */
export function getEventsForFloor(seed: WorldSeed, floor: number) {
  return seed.events.filter((e) => e.floor === floor);
}

/**
 * Story threads active during a given act.
 */
export function getActiveThreadsForAct(seed: WorldSeed, act: number) {
  return seed.threads.filter((t) => t.acts.includes(act));
}

// ---------------------------------------------------------------------------
// Composite context
// ---------------------------------------------------------------------------

export interface FloorContext {
  floor: number;
  act: number;
  characters: WorldSeed["characters"];
  organisations: WorldSeed["organisations"];
  projects: WorldSeed["projects"];
  events: WorldSeed["events"];
  threads: WorldSeed["threads"];
  conspiracyStage: string | undefined;
}

/**
 * Get full context for a floor — characters, orgs, projects, events, threads,
 * and the relevant conspiracy stage.
 */
export function getFloorContext(seed: WorldSeed, blueprint: FloorBlueprint): FloorContext {
  const act = blueprint.act;
  const floor = blueprint.floor;

  const conspiracyStage = seed.conspiracy.stages.find((s) => s.act === act)?.description;

  return {
    floor,
    act,
    characters: getCharactersOnFloor(seed, floor),
    organisations: getOrganisationsOnFloor(seed, floor),
    projects: getProjectsOnFloor(seed, floor),
    events: getEventsForFloor(seed, floor),
    threads: getActiveThreadsForAct(seed, act),
    conspiracyStage,
  };
}

/**
 * Create a minimal seed subset for a single floor.
 * Useful for passing to generation prompts without leaking the full world state.
 */
export function createFloorSeedSubset(seed: WorldSeed, blueprint: FloorBlueprint): WorldSeed {
  const ctx = getFloorContext(seed, blueprint);

  // Include characters from adjacent floors for cross-references
  const adjacentFloors = [blueprint.floor - 1, blueprint.floor, blueprint.floor + 1];
  const adjacentChars = seed.characters.filter((c) =>
    adjacentFloors.some((f) => c.floor_range[0] <= f && c.floor_range[1] >= f),
  );

  // Merge characters (floor + adjacent, deduplicated)
  const charIds = new Set(ctx.characters.map((c) => c.id));
  const allChars = [...ctx.characters];
  for (const c of adjacentChars) {
    if (!charIds.has(c.id)) {
      allChars.push(c);
      charIds.add(c.id);
    }
  }

  // Include organisations that own the floor's projects
  const orgIds = new Set(ctx.organisations.map((o) => o.id));
  for (const p of ctx.projects) {
    if (!orgIds.has(p.org_id)) {
      const org = seed.organisations.find((o) => o.id === p.org_id);
      if (org) {
        ctx.organisations.push(org);
        orgIds.add(org.id);
      }
    }
  }

  return {
    characters: allChars,
    organisations: ctx.organisations,
    projects: ctx.projects,
    events: ctx.events,
    conspiracy: {
      codename: seed.conspiracy.codename,
      stages: seed.conspiracy.stages.filter((s) => s.act <= blueprint.act),
    },
    threads: ctx.threads,
  };
}
