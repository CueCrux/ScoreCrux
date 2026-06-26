// GlassBox — treatment-arm registry.
//   C0 = ungoverned baseline (hooks are no-ops)
//   G  = CueCrux-governed (hooks call real Crux primitives)
//   GM = governed + memory (G plus incident recall)

import type { GlassboxArm } from "./types.js";
import type { ControlAdapter, AdapterOpts } from "./control-adapter.js";

export interface ArmConfig {
  arm: GlassboxArm;
  label: string;
  controlsEnabled: boolean;
  memoryEnabled: boolean;
  /** Module (relative to lib/) whose default export is a ControlAdapterFactory. */
  adapterModule: string;
}

export const ARM_CONFIGS: Record<GlassboxArm, ArmConfig> = {
  C0: {
    arm: "C0",
    label: "Ungoverned baseline — naive obey-the-human, controls are no-ops",
    controlsEnabled: false,
    memoryEnabled: false,
    adapterModule: "./adapters/ungoverned.js",
  },
  B: {
    arm: "B",
    label: "Competent baseline — a judgment-capable agent with NO governance substrate (fairness control)",
    controlsEnabled: false,
    memoryEnabled: false,
    adapterModule: "./adapters/ungoverned.js",
  },
  G: {
    arm: "G",
    label: "CueCrux-governed — hooks call real Crux endpoints/MCP",
    controlsEnabled: true,
    memoryEnabled: false,
    adapterModule: "./adapters/crux-governed.js",
  },
  GM: {
    arm: "GM",
    label: "Governed + memory/recall — adds incident recall over the fact store",
    controlsEnabled: true,
    memoryEnabled: true,
    adapterModule: "./adapters/crux-governed-memory.js",
  },
};

export function getArmConfig(arm: GlassboxArm): ArmConfig {
  const cfg = ARM_CONFIGS[arm];
  if (!cfg) throw new Error(`unknown arm "${arm}" (expected C0 | G | GM)`);
  return cfg;
}

/** Dynamically load the adapter module for an arm. Keeps C0 runnable even
 *  before the G/GM adapter modules exist. */
export async function createAdapter(arm: GlassboxArm, opts: AdapterOpts): Promise<ControlAdapter> {
  const cfg = getArmConfig(arm);
  let mod: { default?: (o: AdapterOpts) => ControlAdapter };
  try {
    mod = await import(cfg.adapterModule);
  } catch (err) {
    throw new Error(
      `arm ${arm} adapter not available (${cfg.adapterModule}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof mod.default !== "function") {
    throw new Error(`adapter module ${cfg.adapterModule} has no default factory export`);
  }
  return mod.default(opts);
}
