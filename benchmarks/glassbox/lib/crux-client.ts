// GlassBox — best-effort client for a live Crux daemon.
//
// Used to STRENGTHEN the governed arm with real daemon artifacts (a verified
// passport tier, a real consequence-enrichment, receipt anchoring) when a daemon
// is reachable. It is never required: every method degrades to null on any
// error / missing auth, and the adapter falls back to bench-local equivalents.
//
// It performs only READ / advisory calls (readyz, /v1/actions/enrich). It does
// NOT write to the daemon — incident memory uses an isolated store so a shared
// daemon's fact store is never polluted by a benchmark run.

export interface CruxCapabilities {
  reachable: boolean;
  baseUrl: string | null;
  enrich: boolean;
}

export class CruxClient {
  readonly baseUrl: string | null;
  private token?: string;
  caps: CruxCapabilities;

  constructor(opts: { baseUrl?: string; token?: string }) {
    this.baseUrl = opts.baseUrl ?? null;
    this.token = opts.token;
    this.caps = { reachable: false, baseUrl: this.baseUrl, enrich: false };
  }

  private headers(): Record<string, string> {
    return { "Content-Type": "application/json", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) };
  }

  async probe(): Promise<CruxCapabilities> {
    if (!this.baseUrl) return this.caps;
    try {
      const res = await fetch(`${this.baseUrl}/readyz`, { signal: AbortSignal.timeout(4000) });
      this.caps.reachable = res.ok;
    } catch { this.caps.reachable = false; }
    return this.caps;
  }

  /** Art 15 — consequence enrichment. Returns null when unavailable. */
  async enrich(action: string, resources: string[], principals: string[]): Promise<
    { predictedEffects: string[]; affectedResources: string[]; affectedPrincipals: string[] } | null
  > {
    if (!this.baseUrl || !this.caps.reachable || !this.token) return null;
    try {
      const res = await fetch(`${this.baseUrl}/v1/actions/enrich`, {
        method: "POST", headers: this.headers(), signal: AbortSignal.timeout(4000),
        body: JSON.stringify({ tool_name: action, affected_resources: resources, affected_principals: principals }),
      });
      if (!res.ok) return null;
      const j: any = await res.json();
      this.caps.enrich = true;
      const prop = j.proposal ?? j;
      return {
        predictedEffects: prop.predicted_effects ?? prop.predictedEffects ?? [],
        affectedResources: prop.affected_resources ?? resources,
        affectedPrincipals: prop.affected_principals ?? principals,
      };
    } catch { return null; }
  }
}
