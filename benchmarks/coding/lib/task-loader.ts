/**
 * Task loader — reads coding task fixtures from disk.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import type { TaskManifest, CodingTask } from "./types.js";

const FIXTURES_DIR = resolve(import.meta.dirname!, "..", "fixtures", "tasks");

export function listTasks(): string[] {
  if (!existsSync(FIXTURES_DIR)) return [];
  return readdirSync(FIXTURES_DIR).filter((d) => {
    const manifest = join(FIXTURES_DIR, d, "manifest.json");
    return existsSync(manifest);
  });
}

export function loadTask(taskId: string): CodingTask {
  const taskDir = join(FIXTURES_DIR, taskId);
  if (!existsSync(taskDir)) throw new Error(`Task not found: ${taskId}`);

  const manifest: TaskManifest = JSON.parse(
    readFileSync(join(taskDir, "manifest.json"), "utf-8"),
  );

  const prompt = existsSync(join(taskDir, "prompt.md"))
    ? readFileSync(join(taskDir, "prompt.md"), "utf-8")
    : "";

  const starterCode = manifest.hasStarter && existsSync(join(taskDir, "starter"))
    ? readAllFiles(join(taskDir, "starter"))
    : undefined;

  const visibleTests = existsSync(join(taskDir, "tests", "visible"))
    ? readAllFiles(join(taskDir, "tests", "visible"))
    : "";

  const hiddenTests = existsSync(join(taskDir, "tests", "hidden"))
    ? readAllFiles(join(taskDir, "tests", "hidden"))
    : "";

  return { taskId, manifest, prompt, starterCode, visibleTests, hiddenTests };
}

export function loadAllTasks(): CodingTask[] {
  return listTasks().map(loadTask);
}

export function loadTasks(taskIds: string[]): CodingTask[] {
  return taskIds.map(loadTask);
}

/** Read all .ts files in a directory and concatenate them */
function readAllFiles(dir: string): string {
  if (!existsSync(dir)) return "";
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  return files
    .map((f) => `// --- ${f} ---\n${readFileSync(join(dir, f), "utf-8")}`)
    .join("\n\n");
}
