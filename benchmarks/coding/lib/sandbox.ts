/**
 * Sandbox execution — runs generated code in an isolated subprocess.
 *
 * For each task:
 * 1. Creates a temp directory
 * 2. Copies starter code (if any) + generated solution
 * 3. Installs dependencies (offline from cache)
 * 4. Runs: tsc → eslint → vitest (visible) → vitest (hidden)
 * 5. Parses results
 * 6. Cleans up
 */

import { mkdirSync, writeFileSync, readFileSync, cpSync, existsSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CodingTask, SandboxResult } from "./types.js";

const TEMP_ROOT = resolve(import.meta.dirname!, "..", ".sandbox-tmp");

export interface SandboxOptions {
  timeoutMs?: number;
  memoryLimitMb?: number;
  verbose?: boolean;
}

export async function runInSandbox(
  task: CodingTask,
  generatedCode: string,
  options: SandboxOptions = {},
): Promise<SandboxResult> {
  const timeoutMs = options.timeoutMs ?? task.manifest.timeoutMs ?? 30000;
  const verbose = options.verbose ?? false;
  const sandboxId = randomUUID().slice(0, 8);
  const sandboxDir = resolve(TEMP_ROOT, `sandbox-${sandboxId}`);

  const result: SandboxResult = {
    buildSuccess: false,
    buildOutput: "",
    typecheckPassed: false,
    typecheckOutput: "",
    lintOutput: "",
    lintErrors: 0,
    lintWarnings: 0,
    visibleTestsPassed: 0,
    visibleTestsTotal: 0,
    visibleTestOutput: "",
    hiddenTestsPassed: 0,
    hiddenTestsTotal: 0,
    hiddenTestOutput: "",
    durationMs: 0,
  };

  const start = Date.now();

  try {
    // 1. Create sandbox directory
    mkdirSync(sandboxDir, { recursive: true });
    mkdirSync(join(sandboxDir, "tests", "visible"), { recursive: true });
    mkdirSync(join(sandboxDir, "tests", "hidden"), { recursive: true });

    // 2. Write package.json
    const pkg = {
      name: `sandbox-${task.taskId}`,
      private: true,
      type: "module",
      devDependencies: {
        typescript: "^5.0.0",
        vitest: "^3.0.0",
      },
    };
    writeFileSync(join(sandboxDir, "package.json"), JSON.stringify(pkg, null, 2));

    // 3. Write tsconfig.json
    const tsconfig = {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        esModuleInterop: true,
        outDir: "dist",
        rootDir: ".",
        declaration: true,
      },
      include: ["*.ts"],
    };
    writeFileSync(join(sandboxDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));

    // 4. Write solution
    writeFileSync(join(sandboxDir, "solution.ts"), generatedCode);

    // 5. Copy starter if present
    if (task.starterCode) {
      writeFileSync(join(sandboxDir, "starter.ts"), task.starterCode);
    }

    // 6. Write tests
    if (task.visibleTests) {
      writeFileSync(join(sandboxDir, "tests", "visible", "test.test.ts"), task.visibleTests);
    }
    if (task.hiddenTests) {
      writeFileSync(join(sandboxDir, "tests", "hidden", "test.test.ts"), task.hiddenTests);
    }

    // 7. Install deps
    try {
      execSync("npm install --prefer-offline --no-audit --no-fund 2>&1", {
        cwd: sandboxDir,
        timeout: 30000,
        stdio: "pipe",
      });
    } catch (e: any) {
      result.buildOutput = `npm install failed: ${e.stderr?.toString().slice(0, 500) ?? e.message}`;
      return result;
    }

    result.buildSuccess = true;
    result.buildOutput = "npm install succeeded";

    // 8. Typecheck
    try {
      const tscOutput = execSync("npx tsc --noEmit 2>&1", {
        cwd: sandboxDir,
        timeout: timeoutMs,
        stdio: "pipe",
      });
      result.typecheckPassed = true;
      result.typecheckOutput = tscOutput.toString().trim();
    } catch (e: any) {
      result.typecheckPassed = false;
      result.typecheckOutput = e.stdout?.toString().slice(0, 1000) ?? e.message;
    }

    // 9. Run visible tests
    try {
      const visibleOutput = execSync(
        "npx vitest run tests/visible/ --reporter json 2>&1 || true",
        { cwd: sandboxDir, timeout: timeoutMs, stdio: "pipe" },
      );
      const parsed = parseVitestJson(visibleOutput.toString());
      result.visibleTestsPassed = parsed.passed;
      result.visibleTestsTotal = parsed.total;
      result.visibleTestOutput = visibleOutput.toString().slice(0, 2000);
    } catch (e: any) {
      result.visibleTestOutput = e.stdout?.toString().slice(0, 1000) ?? e.message;
    }

    // 10. Run hidden tests
    try {
      const hiddenOutput = execSync(
        "npx vitest run tests/hidden/ --reporter json 2>&1 || true",
        { cwd: sandboxDir, timeout: timeoutMs, stdio: "pipe" },
      );
      const parsed = parseVitestJson(hiddenOutput.toString());
      result.hiddenTestsPassed = parsed.passed;
      result.hiddenTestsTotal = parsed.total;
      result.hiddenTestOutput = hiddenOutput.toString().slice(0, 2000);
    } catch (e: any) {
      result.hiddenTestOutput = e.stdout?.toString().slice(0, 1000) ?? e.message;
    }

    // 11. Lint (best-effort, don't fail if eslint not available)
    try {
      const lintOutput = execSync(
        "npx tsc --noEmit --pretty false 2>&1 | head -50 || true",
        { cwd: sandboxDir, timeout: 10000, stdio: "pipe" },
      );
      result.lintOutput = lintOutput.toString().trim();
      // Count error lines (rough heuristic)
      const lines = result.lintOutput.split("\n");
      result.lintErrors = lines.filter((l) => l.includes("error TS")).length;
      result.lintWarnings = lines.filter((l) => l.includes("warning")).length;
    } catch {
      // Lint is best-effort
    }
  } finally {
    result.durationMs = Date.now() - start;

    // Cleanup
    try {
      rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  }

  return result;
}

/** Parse vitest JSON output to extract pass/fail counts */
function parseVitestJson(output: string): { passed: number; total: number } {
  try {
    // vitest --reporter json outputs JSON to stdout
    // Find the JSON object in the output
    const jsonMatch = output.match(/\{[\s\S]*"numPassedTests"[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return {
        passed: data.numPassedTests ?? 0,
        total: (data.numPassedTests ?? 0) + (data.numFailedTests ?? 0),
      };
    }

    // Fallback: count "✓" and "×" in output
    const passCount = (output.match(/✓|✔|passed/gi) ?? []).length;
    const failCount = (output.match(/×|✗|failed/gi) ?? []).length;
    return { passed: passCount, total: passCount + failCount };
  } catch {
    return { passed: 0, total: 0 };
  }
}
