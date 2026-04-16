# ScoreCrux Public Data

This directory holds the public snapshot of ScoreCrux benchmark submissions. It is regenerated daily from the live scorecrux.com data store by the exporter at [`../scripts/export-public-data.ts`](../scripts/export-public-data.ts). Machine-readable and human-browsable.

If scorecrux.com is ever offline, the site can be rebuilt from this directory — see **Rebuilding the site** below.

## Contents

```
public-data/
├── index.json                      # manifest: counts, generation time, policy
├── intelligence/<runId>.json       # Intelligence benchmark submissions
├── coding/<runId>.json             # Coding benchmark submissions
├── scale/<runId>.json              # Scale benchmark submissions
├── topfloor/campaign_<id>.json     # Top Floor campaign records
└── pending-models/<modelId>.json   # Proposed new models, aggregated
```

Each surface folder contains one JSON file per record. The schema matches the live API responses (e.g. `/api/intelligence/leaderboard`) — anything you can pull from the leaderboard endpoint is present here too.

## Policy

### Embargo — 48 hours

Records are **not** published until at least 48 hours after submission. This gives submitters a window to withdraw or amend a run before it becomes part of the permanent public record. Override at export time with `--embargo-hours N` or the `PUBLIC_EXPORT_EMBARGO_HOURS` env var.

### Excluded

The exporter drops records that match any of:

- `leaderboard_visible === false` — explicitly hidden at submit time
- `fixture_tier === "practice"` — practice runs, not ranked
- `hidden === true` — later hidden by the submitter or moderator
- `scope === "private"` — flagged private
- Records newer than the embargo window

### Redacted (stripped from every record)

- `claimCode` — single-use auth token
- `submitterPlayerId` — internal identifier
- `ip`, `clientIp`, `remoteAddress` — any captured IP data
- `sessionToken`, `token` — auth material
- `audit`, `auditLog` — internal ops logs

For `pending-models/*.json`, per-observation submitter IDs and organizations are aggregated into counts (`distinctSubmitters`, `distinctOrganizations`); individual identities are never published.

### Kept (publicly visible on the site already)

- `submitter` (alias) and `organization` — shown on the leaderboard
- `githubLogin` — shown on the leaderboard
- Model ID, attribution tier, `reportedModel`, `apiBase`
- All scores, category breakdowns, factor breakdowns, cost/duration
- `submittedAt`, `date`

## Rebuilding the site

If scorecrux.com needs to be reconstructed from scratch:

```bash
# 1. Clone the repo (this one).
git clone https://github.com/CueCrux/ScoreCrux.git
cd ScoreCrux

# 2. Rebuild the data-dir layout Frontdoor expects.
./scripts/rebuild-site-data.sh /var/lib/scorecrux-frontdoor/data/topfloor

# 3. Clone ScoreCrux-Frontdoor and point it at the restored directory.
git clone https://github.com/CueCrux/ScoreCrux-Frontdoor.git
cd ScoreCrux-Frontdoor
TOPFLOOR_DATA_DIR=/var/lib/scorecrux-frontdoor/data/topfloor pnpm dev
```

Caveats for a rebuilt site:

- **Auth is gone.** Players can't log back into their old submissions; claim codes are not in the public data. New submissions work normally; amending historical submissions requires admin intervention.
- **Audit trails are gone.** Per-submission audit logs (who submitted from which IP) don't exist in the public export.
- **The SQLite DB is not restored.** Only the JSON submission store. If the site used any functionality that depended on the SQLite rows (non-leaderboard analytics), those will start empty.

## Export cadence

A systemd timer on the Frontdoor host (`scorecrux-public-data-export.timer`) runs daily at 03:00 UTC. The unit files live at [`../../ScoreCrux-Frontdoor/scripts/systemd/`](../../ScoreCrux-Frontdoor/scripts/systemd/).

Each run produces either zero commits (nothing changed) or exactly one commit per day with a message like:

```
data: daily public-data sync (intelligence:3 coding:7 scale:42 topfloor:12)

Embargoed records held for 48h; private/practice/hidden records excluded; PII redacted.
```

## Manual export

From a checkout of this repo:

```bash
# Dry-run — show what would change, don't write anything
npx tsx scripts/export-public-data.ts --dry-run

# Normal run — write files, commit, push
npx tsx scripts/export-public-data.ts

# Local-only — commit but don't push
npx tsx scripts/export-public-data.ts --no-push

# Different embargo window
npx tsx scripts/export-public-data.ts --embargo-hours 72
```

## Opting out

If you want a specific run removed from the public export:

1. Before the 48h embargo expires, delete or hide the run via the site (this also removes it from the live leaderboard).
2. If already published, file an issue on this repo and we'll remove it from both source and public-data in the next sync.

The exporter is **idempotent** — removing a record from the live store causes the corresponding `public-data/*.json` file to be deleted on the next run.
