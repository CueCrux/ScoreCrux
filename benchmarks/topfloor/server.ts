#!/usr/bin/env npx tsx
/**
 * ScoreCrux Top Floor — API Server
 *
 * Zero-dependency HTTP server (Node built-ins only + @aws-sdk for avatar storage).
 *
 * Provides:
 *   - Player identity (anonymous, claim code, GitHub OAuth)
 *   - Avatar upload (Hetzner Object Storage presigned URLs)
 *   - Leaderboard (overall, per-model, per-floor, speedrun)
 *   - Save/resume game state
 *
 * Port: 3210
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

import {
  createAnonymousPlayer,
  loadPlayerBySession,
  loadPlayerByClaimCode,
  persistPlayer,
  claimProfile,
  resumeWithClaimCode,
  exchangeGitHubCode,
  linkGitHub,
  getAvatarKey,
  setAvatarUrl,
  toPublicProfile,
  type PlayerProfile,
} from "./lib/player.js";

import {
  createSave,
  loadSave,
  listSaves,
  formatSaveStatus,
} from "./lib/save-state.js";

import {
  buildLeaderboard,
  buildFloorLeaderboard,
  formatLeaderboard as fmtLb,
  type LeaderboardSort,
} from "./lib/leaderboard.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.TOPFLOOR_PORT ?? 3215);
const DATA_DIR = resolve(import.meta.dirname!, "data");
const RESULTS_DIR = resolve(import.meta.dirname!, "results");

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? "";

const S3_ENDPOINT = process.env.OBJECT_STORAGE_ENDPOINT ?? "";
const S3_BUCKET = process.env.OBJECT_STORAGE_BUCKET ?? "cuecrux-media";

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(RESULTS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// HTTP Helpers
// ---------------------------------------------------------------------------

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, status: number, message: string) {
  json(res, { error: message }, status);
}

async function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

function getSession(req: IncomingMessage): string | null {
  // Check Authorization header
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);

  // Check cookie
  const cookies = req.headers.cookie ?? "";
  const match = cookies.match(/tf_session=([^;]+)/);
  return match?.[1] ?? null;
}

function getPlayer(req: IncomingMessage): PlayerProfile | null {
  const token = getSession(req);
  if (!token) return null;
  return loadPlayerBySession(token, DATA_DIR);
}

function setSessionCookie(res: ServerResponse, token: string) {
  const maxAge = 90 * 24 * 60 * 60;
  res.setHeader("Set-Cookie", `tf_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf("?");
  if (idx < 0) return {};
  const params: Record<string, string> = {};
  for (const pair of url.slice(idx + 1).split("&")) {
    const [k, v] = pair.split("=");
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
  }
  return params;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

type Handler = (req: IncomingMessage, res: ServerResponse, params?: Record<string, string>) => Promise<void> | void;

const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [];

function route(method: string, path: string, handler: Handler) {
  // Convert /api/saves/:id to regex
  const pattern = new RegExp("^" + path.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$");
  routes.push({ method, pattern, handler });
}

// --- Health ---
route("GET", "/healthz", (_req, res) => json(res, { status: "ok", service: "topfloor-api" }));

// --- Session ---
route("POST", "/api/session", async (req, res) => {
  const body = await readJson(req);

  if (body.claimCode) {
    const result = resumeWithClaimCode(body.claimCode, DATA_DIR);
    if (!result) return error(res, 404, "Invalid claim code.");
    setSessionCookie(res, result.session.sessionToken);
    return json(res, { player: toPublicProfile(result.player), claimCode: result.player.claimCode, resumed: true });
  }

  const { player, session } = createAnonymousPlayer(DATA_DIR);
  setSessionCookie(res, session.sessionToken);
  json(res, { player: toPublicProfile(player), claimCode: player.claimCode, resumed: false });
});

// --- Me ---
route("GET", "/api/me", (req, res) => {
  const player = getPlayer(req);
  if (!player) return error(res, 401, "Not authenticated.");
  json(res, { player: toPublicProfile(player), claimCode: player.claimCode, tier: player.tier, saveIds: player.saveIds, preferences: player.preferences });
});

route("PATCH", "/api/me", async (req, res) => {
  const player = getPlayer(req);
  if (!player) return error(res, 401, "Not authenticated.");
  const body = await readJson(req);
  if (body.alias) claimProfile(player, body.alias, DATA_DIR);
  if (body.preferences) { Object.assign(player.preferences, body.preferences); persistPlayer(player, DATA_DIR); }
  json(res, { player: toPublicProfile(player), claimCode: player.claimCode });
});

// --- Claim ---
route("POST", "/api/claim", async (req, res) => {
  const player = getPlayer(req);
  if (!player) return error(res, 401, "Not authenticated.");
  const body = await readJson(req);
  if (!body.alias?.trim()) return error(res, 400, "Alias is required.");
  const result = claimProfile(player, body.alias, DATA_DIR);
  json(res, { player: toPublicProfile(result.player), claimCode: result.claimCode, message: `Your code: ${result.claimCode}` });
});

// --- GitHub OAuth ---
route("GET", "/api/auth/github", (req, res) => {
  if (!GITHUB_CLIENT_ID) return error(res, 503, "GitHub OAuth not configured.");
  const proto = req.headers["x-forwarded-proto"] ?? "http";
  const host = req.headers.host ?? "localhost:3210";
  const redirect = `${proto}://${host}/api/auth/github/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirect)}&scope=read:user`;
  res.writeHead(302, { Location: url });
  res.end();
});

route("GET", "/api/auth/github/callback", async (req, res) => {
  const query = parseQuery(req.url ?? "");
  if (!query.code) return error(res, 400, "Missing code.");
  const player = getPlayer(req);
  if (!player) return error(res, 401, "Start a session first.");
  try {
    const ghUser = await exchangeGitHubCode(query.code, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET);
    linkGitHub(player, ghUser, DATA_DIR);
    res.writeHead(302, { Location: "/?linked=github" });
    res.end();
  } catch (e: any) {
    error(res, 500, `GitHub auth failed: ${e.message}`);
  }
});

// --- Avatar ---
route("POST", "/api/avatar/presign", async (req, res) => {
  const player = getPlayer(req);
  if (!player) return error(res, 401, "Not authenticated.");
  if (!S3_ENDPOINT) return error(res, 503, "Object storage not configured.");

  const body = await readJson(req);
  const ext = (body.contentType?.split("/")?.[1] ?? "png").toLowerCase();
  if (!["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return error(res, 400, "Unsupported image format.");

  const key = getAvatarKey(player.playerId, ext);
  // Generate presigned PUT URL (using AWS SDK if available, or return key for client to upload)
  const publicUrl = `${S3_ENDPOINT}/${S3_BUCKET}/${key}`;
  json(res, { key, publicUrl, bucket: S3_BUCKET, expiresIn: 300 });
});

route("POST", "/api/avatar/confirm", async (req, res) => {
  const player = getPlayer(req);
  if (!player) return error(res, 401, "Not authenticated.");
  const body = await readJson(req);
  if (!body.url) return error(res, 400, "Missing avatar URL.");
  setAvatarUrl(player, body.url, DATA_DIR);
  json(res, { player: toPublicProfile(player) });
});

// --- Saves ---
route("POST", "/api/saves", async (req, res) => {
  const player = getPlayer(req);
  if (!player) return error(res, 401, "Not authenticated.");
  const body = await readJson(req);
  const save = createSave(body.model ?? player.preferences.defaultModel, body.arm ?? player.preferences.defaultArm, body.saveName, RESULTS_DIR);
  player.saveIds.push(save.saveId);
  persistPlayer(player, DATA_DIR);
  json(res, { save });
});

route("GET", "/api/saves", (req, res) => {
  const player = getPlayer(req);
  if (!player) return error(res, 401, "Not authenticated.");
  const saves = player.saveIds.map((id) => loadSave(id, RESULTS_DIR)).filter(Boolean);
  json(res, { saves });
});

route("GET", "/api/saves/:id", (req, res, params) => {
  const player = getPlayer(req);
  if (!player) return error(res, 401, "Not authenticated.");
  const saveId = params?.id;
  if (!saveId || !player.saveIds.includes(saveId)) return error(res, 403, "Save not yours.");
  const save = loadSave(saveId, RESULTS_DIR);
  if (!save) return error(res, 404, "Save not found.");
  json(res, { save, status: formatSaveStatus(save) });
});

// --- Leaderboard ---
route("GET", "/api/leaderboard", (req, res) => {
  const q = parseQuery(req.url ?? "");
  const lb = buildLeaderboard(DATA_DIR, (q.sort ?? "highest_floor") as LeaderboardSort, { model: q.model, arm: q.arm }, Number(q.limit ?? 100));
  json(res, lb);
});

route("GET", "/api/leaderboard/floor/:floor", (req, res, params) => {
  const floor = Number(params?.floor);
  if (isNaN(floor) || floor < 1 || floor > 100) return error(res, 400, "Invalid floor.");
  json(res, buildFloorLeaderboard(floor, DATA_DIR));
});

route("GET", "/api/leaderboard/formatted", (req, res) => {
  const q = parseQuery(req.url ?? "");
  const lb = buildLeaderboard(DATA_DIR, (q.sort ?? "highest_floor") as LeaderboardSort);
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(fmtLb(lb));
});

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    });
    return res.end();
  }

  const url = (req.url ?? "/").split("?")[0];
  const method = req.method ?? "GET";

  for (const r of routes) {
    if (r.method !== method) continue;
    const match = url.match(r.pattern);
    if (!match) continue;
    try {
      await r.handler(req, res, match.groups as Record<string, string>);
    } catch (e: any) {
      console.error(`Error handling ${method} ${url}:`, e.message);
      if (!res.headersSent) error(res, 500, e.message);
    }
    return;
  }

  error(res, 404, `Not found: ${method} ${url}`);
});

server.listen(PORT, () => {
  console.log(`\nScoreCrux Top Floor API — http://localhost:${PORT}`);
  console.log(`  Data: ${DATA_DIR}`);
  console.log(`  GitHub OAuth: ${GITHUB_CLIENT_ID ? "configured" : "not configured"}`);
  console.log(`  Object Storage: ${S3_ENDPOINT ? "configured" : "not configured"}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /api/session         Start/resume session`);
  console.log(`  GET  /api/me              Player profile`);
  console.log(`  PATCH /api/me             Update alias/prefs`);
  console.log(`  POST /api/claim           Claim profile + get code`);
  console.log(`  GET  /api/auth/github      GitHub OAuth flow`);
  console.log(`  POST /api/avatar/presign   Avatar upload URL`);
  console.log(`  POST /api/avatar/confirm   Confirm avatar`);
  console.log(`  POST /api/saves           Create save`);
  console.log(`  GET  /api/saves           List saves`);
  console.log(`  GET  /api/leaderboard     Public leaderboard`);
  console.log(`  GET  /api/leaderboard/floor/:n  Per-floor board`);
});
