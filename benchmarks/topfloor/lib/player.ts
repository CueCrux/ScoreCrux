/**
 * ScoreCrux Top Floor — Player Identity System
 *
 * Three-tier identity with zero friction entry:
 *
 *   1. ANONYMOUS  — auto-created on first visit. localStorage session.
 *                   Shows as "Agent [hash]" on leaderboard.
 *
 *   2. CLAIMED    — player generates a short claim code (e.g., TOWER-7F3K-9X2P).
 *                   Can set alias + avatar. Resumable on any device via code.
 *
 *   3. LINKED     — GitHub OAuth. Leaderboard shows GitHub username/avatar.
 *                   Claim code still works as fallback.
 *
 * Avatar storage: Hetzner Object Storage (S3-compatible) in cuecrux-media bucket.
 */

import { randomUUID, createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthTier = "anonymous" | "claimed" | "linked";

export interface PlayerProfile {
  /** Internal player ID (UUID) */
  playerId: string;
  /** Auth tier */
  tier: AuthTier;
  /** Display alias (default: "Agent [hash]") */
  alias: string;
  /** Avatar URL (Hetzner Object Storage or GitHub) */
  avatarUrl: string | null;
  /** Short claim code for cross-device resume (e.g., TOWER-7F3K-9X2P) */
  claimCode: string;
  /** Hashed claim code for verification (SHA-256) */
  claimCodeHash: string;
  /** GitHub user info (if linked) */
  github: {
    id: number;
    login: string;
    avatarUrl: string;
    name: string | null;
  } | null;
  /** When created */
  createdAt: string;
  /** When last active */
  lastActiveAt: string;
  /** Associated save IDs */
  saveIds: string[];
  /** Player preferences */
  preferences: {
    /** Preferred model for runs */
    defaultModel: string;
    /** Preferred arm */
    defaultArm: string;
    /** Show on public leaderboard */
    publicLeaderboard: boolean;
  };
}

export interface PlayerSession {
  /** Session token (stored in cookie/localStorage) */
  sessionToken: string;
  /** Player ID this session belongs to */
  playerId: string;
  /** When created */
  createdAt: string;
  /** When it expires */
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Claim Code Generation
// ---------------------------------------------------------------------------

const CLAIM_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // No 0/O/1/I/L confusion

function generateClaimCode(): string {
  const bytes = randomBytes(9);
  let code = "TOWER-";
  for (let i = 0; i < 9; i++) {
    if (i === 4) code += "-";
    code += CLAIM_ALPHABET[bytes[i] % CLAIM_ALPHABET.length];
  }
  return code;
}

function hashClaimCode(code: string): string {
  return createHash("sha256").update(code.toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
}

function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function generateDefaultAlias(playerId: string): string {
  const hash = createHash("sha256").update(playerId).digest("hex").slice(0, 6).toUpperCase();
  return `Agent ${hash}`;
}

// ---------------------------------------------------------------------------
// Player Storage
// ---------------------------------------------------------------------------

const PLAYERS_DIR_NAME = "players";

function getPlayersDir(dataDir: string): string {
  return join(dataDir, PLAYERS_DIR_NAME);
}

function getPlayerPath(dataDir: string, playerId: string): string {
  return join(getPlayersDir(dataDir), `${playerId}.json`);
}

function getSessionsDir(dataDir: string): string {
  return join(dataDir, "sessions");
}

function getSessionPath(dataDir: string, token: string): string {
  const hash = createHash("sha256").update(token).digest("hex").slice(0, 16);
  return join(getSessionsDir(dataDir), `${hash}.json`);
}

// ---------------------------------------------------------------------------
// Player CRUD
// ---------------------------------------------------------------------------

/** Create a new anonymous player. Returns profile + session. */
export function createAnonymousPlayer(dataDir: string): {
  player: PlayerProfile;
  session: PlayerSession;
} {
  const playerId = randomUUID();
  const claimCode = generateClaimCode();
  const now = new Date().toISOString();

  const player: PlayerProfile = {
    playerId,
    tier: "anonymous",
    alias: generateDefaultAlias(playerId),
    avatarUrl: null,
    claimCode,
    claimCodeHash: hashClaimCode(claimCode),
    github: null,
    createdAt: now,
    lastActiveAt: now,
    saveIds: [],
    preferences: {
      defaultModel: "claude-sonnet-4-6",
      defaultArm: "T2",
      publicLeaderboard: true,
    },
  };

  const session = createSession(playerId, dataDir);
  persistPlayer(player, dataDir);

  return { player, session };
}

/** Create a session for a player. */
function createSession(playerId: string, dataDir: string): PlayerSession {
  const token = generateSessionToken();
  const now = new Date();
  const session: PlayerSession = {
    sessionToken: token,
    playerId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
  };

  mkdirSync(getSessionsDir(dataDir), { recursive: true });
  writeFileSync(getSessionPath(dataDir, token), JSON.stringify(session, null, 2));
  return session;
}

/** Persist player to disk. */
export function persistPlayer(player: PlayerProfile, dataDir: string): void {
  mkdirSync(getPlayersDir(dataDir), { recursive: true });
  player.lastActiveAt = new Date().toISOString();
  writeFileSync(getPlayerPath(dataDir, player.playerId), JSON.stringify(player, null, 2));
}

/** Load player by ID. */
export function loadPlayer(playerId: string, dataDir: string): PlayerProfile | null {
  const path = getPlayerPath(dataDir, playerId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as PlayerProfile;
}

/** Load player by session token. */
export function loadPlayerBySession(token: string, dataDir: string): PlayerProfile | null {
  const sessionPath = getSessionPath(dataDir, token);
  if (!existsSync(sessionPath)) return null;

  const session = JSON.parse(readFileSync(sessionPath, "utf-8")) as PlayerSession;
  if (new Date(session.expiresAt) < new Date()) return null; // expired

  return loadPlayer(session.playerId, dataDir);
}

/** Load player by claim code. */
export function loadPlayerByClaimCode(code: string, dataDir: string): PlayerProfile | null {
  const hash = hashClaimCode(code);
  const playersDir = getPlayersDir(dataDir);
  if (!existsSync(playersDir)) return null;

  for (const file of readdirSync(playersDir).filter((f) => f.endsWith(".json"))) {
    const player = JSON.parse(readFileSync(join(playersDir, file), "utf-8")) as PlayerProfile;
    if (player.claimCodeHash === hash) return player;
  }
  return null;
}

/** List all players (for leaderboard). */
export function listPlayers(dataDir: string): PlayerProfile[] {
  const playersDir = getPlayersDir(dataDir);
  if (!existsSync(playersDir)) return [];

  return readdirSync(playersDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(playersDir, f), "utf-8")) as PlayerProfile);
}

// ---------------------------------------------------------------------------
// Claim (upgrade from anonymous)
// ---------------------------------------------------------------------------

/**
 * Claim a player profile — sets alias, upgrades tier to "claimed".
 * The claim code was auto-generated at creation; this just reveals it
 * to the player and lets them set an alias.
 */
export function claimProfile(
  player: PlayerProfile,
  alias: string,
  dataDir: string,
): { player: PlayerProfile; claimCode: string } {
  player.tier = player.tier === "linked" ? "linked" : "claimed";
  player.alias = alias.trim().slice(0, 30) || player.alias;
  persistPlayer(player, dataDir);
  return { player, claimCode: player.claimCode };
}

/**
 * Resume a session using a claim code.
 * Creates a new session for the player on this device.
 */
export function resumeWithClaimCode(
  code: string,
  dataDir: string,
): { player: PlayerProfile; session: PlayerSession } | null {
  const player = loadPlayerByClaimCode(code, dataDir);
  if (!player) return null;

  const session = createSession(player.playerId, dataDir);
  player.lastActiveAt = new Date().toISOString();
  persistPlayer(player, dataDir);

  return { player, session };
}

// ---------------------------------------------------------------------------
// GitHub OAuth Link
// ---------------------------------------------------------------------------

export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
  name: string | null;
}

/**
 * Exchange GitHub OAuth code for user info.
 * Requires GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET env vars.
 */
export async function exchangeGitHubCode(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<GitHubUser> {
  // Exchange code for token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!tokenRes.ok) throw new Error(`GitHub token exchange failed: ${tokenRes.status}`);
  const tokenData = (await tokenRes.json()) as GitHubTokenResponse;
  if (!tokenData.access_token) throw new Error("No access token in GitHub response");

  // Fetch user profile
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!userRes.ok) throw new Error(`GitHub user fetch failed: ${userRes.status}`);
  return (await userRes.json()) as GitHubUser;
}

/**
 * Link a GitHub account to a player profile.
 * Upgrades tier to "linked", sets GitHub avatar as default.
 */
export function linkGitHub(
  player: PlayerProfile,
  githubUser: GitHubUser,
  dataDir: string,
): PlayerProfile {
  player.tier = "linked";
  player.github = {
    id: githubUser.id,
    login: githubUser.login,
    avatarUrl: githubUser.avatar_url,
    name: githubUser.name,
  };

  // Use GitHub avatar if no custom avatar
  if (!player.avatarUrl) {
    player.avatarUrl = githubUser.avatar_url;
  }

  // Use GitHub name as alias if still default
  if (player.alias.startsWith("Agent ") && githubUser.name) {
    player.alias = githubUser.name;
  }

  persistPlayer(player, dataDir);
  return player;
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

export interface AvatarUploadResult {
  url: string;
  key: string;
}

/**
 * Generate the S3 key for a player's avatar.
 */
export function getAvatarKey(playerId: string, ext: string): string {
  const ts = Date.now();
  return `topfloor/avatars/${playerId}/${ts}.${ext}`;
}

/**
 * Update the player's avatar URL after upload.
 */
export function setAvatarUrl(
  player: PlayerProfile,
  url: string,
  dataDir: string,
): void {
  player.avatarUrl = url;
  persistPlayer(player, dataDir);
}

// ---------------------------------------------------------------------------
// Profile Display
// ---------------------------------------------------------------------------

export interface PublicProfile {
  playerId: string;
  alias: string;
  avatarUrl: string | null;
  tier: AuthTier;
  githubLogin: string | null;
}

export function toPublicProfile(player: PlayerProfile): PublicProfile {
  return {
    playerId: player.playerId,
    alias: player.alias,
    avatarUrl: player.avatarUrl,
    tier: player.tier,
    githubLogin: player.github?.login ?? null,
  };
}
