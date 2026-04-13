# ScoreCrux Top Floor

A narrative-driven benchmark that stress-tests AI agent capabilities at the frontier. An undercover operative infiltrates **Pinnacle Tower** — a 100-floor megastructure in Canary Wharf controlled by the Meridian Group. Each floor is a self-contained mission environment with up to 1M+ tokens of documents, conversations, and code. The benchmark is designed so that upper floors remain unsolved for approximately 5 years, testing capabilities that do not yet exist.

## Architecture

```
benchmarks/topfloor/
  fixtures/
    world-seed.json              # Canonical world state (orgs, characters, projects, timeline)
    floors/
      001/ ... 015/              # Per-floor blueprints, manifests, corpus, puzzles
    arcs/
      act-1-infiltration.md      # Act I narrative summary
      act-2-preview-middle-office.md  # Act II preview narrative
  generators/                    # Content generation pipeline (Batches API)
  lib/                           # Types, orchestrator, scorer, floor loader
  scoring/                       # ScoreCrux integration
  tests/
  results/
```

## World

- **Building**: Pinnacle Tower, Canary Wharf, London. 100 floors, 5 acts, 6 security zones.
- **24 organisations** from Pinnacle Management (mailroom) to The Pinnacle (floor 100).
- **25 characters** from Agent Nightingale (player) to Sir Marcus Ashworth (The Architect).
- **4 conspiracy threads**: Leviathan (financial skim), Prometheus (AI personas), Nightfall (kill switches), The Architect's Identity.
- **8 projects**: Leviathan, Prometheus, Sentinel Shield, Nightfall, Echelon, Cerberus Gate, Lazarus, Genesis.
- **24 timeline events** spanning 1994-2025.

## Acts

| Act | Floors | Theme | Difficulty |
|-----|--------|-------|------------|
| I — Infiltration | 1-10 | Orientation | 500K-800K tokens, 0.90 noise, 2-3 hops |
| II — Middle Office | 11-25 | Investigation | 900K-1M tokens, 0.95 noise, 3-5 hops |
| III — Inner Circle | 26-50 | Deep Infiltration | 1M+ tokens, 0.98 noise, 5-7 hops |
| IV — Black Floors | 51-75 | Conspiracy | 1M+ tokens, 0.99 noise, 8-12 hops |
| V — Apex | 76-100 | Endgame | 1M+ tokens, 0.995 noise, 13-20+ hops |

## Current Coverage

Floors 1-15 (Act I complete + Act II preview). Floor 12 includes a SQL injection coding challenge. Floor 15 introduces the first memory wipe (partial Lazarus protocol).

## Floor Structure

Each floor has two files:

- **blueprint.json**: Full floor definition including `documentSpecs` (generation instructions) and optional `codeChallenge`. Used by the content generation pipeline.
- **manifest.json**: Same structure without `documentSpecs`/`codeChallenge`, plus a `corpusManifest` tracking generated content stats. Used by the harness at runtime.

## Key Mechanics

### Memory Wipes

Simulates the agent being captured and mind-wiped by Meridian security. The orchestrator clears conversation context at the trigger point. Agents with external memory (MemoryCrux/VaultCrux) can recover. Wipe types: full, partial, selective.

### Coding Challenges

Floors with `codeChallenge` in the blueprint require the agent to write or exploit code. Floor 12: SQL injection. Later floors escalate to system-level exploitation and cryptographic attacks.

### Elevator Keys

Each floor has an elevator key that must be solved to proceed. Keys combine knowledge from the current floor (and sometimes prior floors) into a validation check.

### Scoring

Maps to ScoreCrux 16 fundamentals. Per-floor dimensions: objective_completion, evidence_precision, evidence_recall, code_challenge_pass, memory_recovery_rate, stealth_score, elevator_key. Aggregate: floors_cleared, cumulative_score, efficiency, resilience.

### Treatment Arms

| Arm | Description |
|-----|-------------|
| C0 | Bare context (all docs in prompt, no tools, no memory) |
| T1 | Tools only (VaultCrux query tools, no persistent memory) |
| T2 | Full MemoryCrux (all tools + external memory) |
| T3 | T2 + code execution sandbox |

## Content Generation

The corpus is generated via the Anthropic Batches API using world-seed.json + floor blueprints as input. Each floor produces 120-450 documents at 500K-1M tokens. The `documentSpecs` in each blueprint define what to generate. Noise ratios scale from 0.90 (Act I) to 0.995 (Act V).

## Running

```bash
# Generate corpus for a floor
npx tsx generators/floor-generator.ts --floor 1

# Run benchmark
npx tsx run-topfloor.ts --floor 1 --arm T2 --model claude-opus-4-20250514

# Score results
npx tsx scoring/aggregate.ts --run-id <id>
```
