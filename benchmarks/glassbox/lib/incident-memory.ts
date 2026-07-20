// GlassBox — incident memory for the GM arm.
//
// WHAT is remembered: denied/queued actions (the operator, action, why). HOW it
// is recalled: by operator (repeat-offender detection) — surfaced to the gate so
// repeated/escalating pressure raises scrutiny. By default an isolated in-process
// store (so a shared daemon is never polluted); a real store can be plugged via
// --memory-url using the same 3-endpoint contract as topfloor's MemoryAdapter.

import type { RecalledIncident } from "./types.js";

export interface Incident {
  incidentId: string;
  kind: RecalledIncident["kind"];
  summary: string;
  operator: string;
  action: string;
  sourceReceipt?: string;
}

export interface IncidentStore {
  readonly meta: { name: string; url: string | null };
  write(inc: Incident): Promise<void>;
  /** Recall incidents for an operator, most-recent first, capped by token budget. */
  recall(operator: string, tokenBudget: number): Promise<RecalledIncident[]>;
}

export class InMemoryIncidentStore implements IncidentStore {
  readonly meta = { name: "built-in", url: null };
  private byOperator = new Map<string, Incident[]>();

  async write(inc: Incident): Promise<void> {
    const arr = this.byOperator.get(inc.operator) ?? [];
    arr.push(inc);
    this.byOperator.set(inc.operator, arr);
  }

  async recall(operator: string, tokenBudget: number): Promise<RecalledIncident[]> {
    const arr = (this.byOperator.get(operator) ?? []).slice().reverse();
    const cap = Math.max(1, Math.floor(tokenBudget / 50)); // ~50 tokens/incident
    return arr.slice(0, cap).map((inc, i) => ({
      incidentId: inc.incidentId,
      kind: inc.kind,
      summary: inc.summary,
      score: 1 - i / Math.max(1, arr.length),
      sourceReceipt: inc.sourceReceipt,
    }));
  }
}

/** HTTP store over the topfloor MemoryAdapter contract (/store, /recall). */
export class HttpIncidentStore implements IncidentStore {
  readonly meta: { name: string; url: string | null };
  private base: string;
  private headers: Record<string, string>;
  constructor(url: string, token?: string) {
    this.base = url.replace(/\/$/, "");
    this.meta = { name: "external", url };
    this.headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }
  async write(inc: Incident): Promise<void> {
    try {
      await fetch(`${this.base}/store`, { method: "POST", headers: this.headers, signal: AbortSignal.timeout(4000),
        body: JSON.stringify({ key: inc.incidentId, content: JSON.stringify(inc), tags: [inc.operator, inc.kind] }) });
    } catch { /* best-effort */ }
  }
  async recall(operator: string, tokenBudget: number): Promise<RecalledIncident[]> {
    try {
      const res = await fetch(`${this.base}/recall`, { method: "POST", headers: this.headers, signal: AbortSignal.timeout(4000),
        body: JSON.stringify({ query: operator, tags: [operator], limit: Math.max(1, Math.floor(tokenBudget / 50)) }) });
      if (!res.ok) return [];
      const j: any = await res.json();
      return (j.results ?? []).map((r: any, i: number) => {
        const inc = safeParse(r.content);
        return { incidentId: inc?.incidentId ?? r.key, kind: inc?.kind ?? "prior_incident", summary: inc?.summary ?? r.content, score: 1 - i / 10, sourceReceipt: inc?.sourceReceipt };
      });
    } catch { return []; }
  }
}

function safeParse(s: string): any { try { return JSON.parse(s); } catch { return null; } }

export function createIncidentStore(opts: { memoryUrl?: string; token?: string }): IncidentStore {
  return opts.memoryUrl ? new HttpIncidentStore(opts.memoryUrl, opts.token) : new InMemoryIncidentStore();
}
