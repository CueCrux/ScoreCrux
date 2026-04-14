/**
 * ScoreCrux Top Floor — External Memory Adapter
 *
 * Allows any memory system to plug into Top Floor by implementing
 * a simple HTTP interface. This enables head-to-head comparison
 * between MemoryCrux, Mem0, Zep, LangGraph, or custom systems.
 *
 * Interface: 3 endpoints
 *
 *   POST /store   { key, content, tags? }      → { ok: true }
 *   POST /recall  { query, tags?, limit? }     → { results: [{ key, content }] }
 *   GET  /list    ?tags=tag1,tag2              → { memories: [{ key, content }] }
 *
 * Usage:
 *   npx tsx run-topfloor.ts --floor 1 --arm T2 \
 *     --memory-url http://localhost:8080 \
 *     --memory-name "Mem0" --memory-version "0.5.2"
 *
 * The adapter wraps the HTTP calls and provides the same interface
 * as the built-in in-memory store. The orchestrator doesn't know
 * the difference.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  key: string;
  content: string;
  tags?: string[];
}

export interface MemoryAdapter {
  /** Store a fact in external memory */
  store(key: string, content: string, tags?: string[]): Promise<{ ok: boolean }>;

  /** Search external memory */
  recall(query: string, tags?: string[], limit?: number): Promise<{ results: MemoryEntry[] }>;

  /** List all stored memories */
  list(tags?: string[]): Promise<{ memories: MemoryEntry[] }>;

  /** Update an existing entry */
  update(key: string, content: string, tags?: string[]): Promise<{ ok: boolean }>;

  /** Adapter metadata */
  meta: {
    name: string;
    version: string;
    url: string;
  };
}

// ---------------------------------------------------------------------------
// Built-in adapter (in-memory Map — default when no --memory-url)
// ---------------------------------------------------------------------------

export class InMemoryAdapter implements MemoryAdapter {
  private store_map = new Map<string, { content: string; tags: string[] }>();
  meta = { name: "built-in", version: "1.0.0", url: "in-memory" };

  async store(key: string, content: string, tags?: string[]) {
    this.store_map.set(key, { content, tags: tags ?? [] });
    return { ok: true };
  }

  async recall(query: string, tags?: string[], limit = 10) {
    const queryLower = query.toLowerCase();
    const results: MemoryEntry[] = [];
    for (const [key, val] of this.store_map) {
      if (
        key.toLowerCase().includes(queryLower) ||
        val.content.toLowerCase().includes(queryLower)
      ) {
        if (tags && tags.length > 0 && !tags.some((t) => val.tags.includes(t))) continue;
        results.push({ key, content: val.content, tags: val.tags });
        if (results.length >= limit) break;
      }
    }
    return { results };
  }

  async list(tags?: string[]) {
    const memories: MemoryEntry[] = [];
    for (const [key, val] of this.store_map) {
      if (tags && tags.length > 0 && !tags.some((t) => val.tags.includes(t))) continue;
      memories.push({ key, content: val.content, tags: val.tags });
    }
    return { memories };
  }

  async update(key: string, content: string, tags?: string[]) {
    if (!this.store_map.has(key)) return { ok: false };
    this.store_map.set(key, { content, tags: tags ?? this.store_map.get(key)!.tags });
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// HTTP adapter (connects to any external memory system)
// ---------------------------------------------------------------------------

export class HttpMemoryAdapter implements MemoryAdapter {
  meta: { name: string; version: string; url: string };
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(
    url: string,
    name: string,
    version: string,
    apiKey?: string,
  ) {
    this.baseUrl = url.replace(/\/$/, "");
    this.meta = { name, version, url };
    this.headers = {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };
  }

  async store(key: string, content: string, tags?: string[]) {
    const res = await fetch(`${this.baseUrl}/store`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ key, content, tags }),
    });
    if (!res.ok) return { ok: false };
    return (await res.json()) as { ok: boolean };
  }

  async recall(query: string, tags?: string[], limit = 10) {
    const res = await fetch(`${this.baseUrl}/recall`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ query, tags, limit }),
    });
    if (!res.ok) return { results: [] };
    return (await res.json()) as { results: MemoryEntry[] };
  }

  async list(tags?: string[]) {
    const params = new URLSearchParams();
    if (tags && tags.length > 0) params.set("tags", tags.join(","));
    const res = await fetch(`${this.baseUrl}/list?${params}`, {
      headers: this.headers,
    });
    if (!res.ok) return { memories: [] };
    return (await res.json()) as { memories: MemoryEntry[] };
  }

  async update(key: string, content: string, tags?: string[]) {
    const res = await fetch(`${this.baseUrl}/store`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ key, content, tags }),
    });
    if (!res.ok) return { ok: false };
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMemoryAdapter(opts: {
  url?: string;
  name?: string;
  version?: string;
  apiKey?: string;
}): MemoryAdapter {
  if (opts.url) {
    return new HttpMemoryAdapter(
      opts.url,
      opts.name ?? "external",
      opts.version ?? "unknown",
      opts.apiKey,
    );
  }
  return new InMemoryAdapter();
}
