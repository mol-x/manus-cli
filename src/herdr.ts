import { spawn } from "node:child_process";

export type HerdrState = "idle" | "working" | "blocked";

const SOURCE = "manus-cli";
const AGENT = "manus";

function envReady(): {
  bin: string;
  paneId: string;
} | null {
  if (process.env.HERDR_ENV !== "1") return null;
  const bin = process.env.HERDR_BIN_PATH;
  const paneId = process.env.HERDR_PANE_ID;
  if (!bin || !paneId) return null;
  return { bin, paneId };
}

function nextSeq(): string {
  return String(Date.now());
}

function runHerdr(args: string[]): void {
  const ctx = envReady();
  if (!ctx) return;

  try {
    const child = spawn(ctx.bin, args, {
      stdio: "ignore",
      detached: true,
      env: process.env,
    });
    child.unref();
  } catch {
    // Herdr reporting must never break the CLI.
  }
}

export function herdrActive(): boolean {
  return envReady() !== null;
}

export function reportHerdrState(
  state: HerdrState,
  opts?: {
    message?: string;
    taskId?: string;
    profile?: string;
  },
): void {
  const ctx = envReady();
  if (!ctx) return;

  const args = [
    "pane",
    "report-agent",
    ctx.paneId,
    "--source",
    SOURCE,
    "--agent",
    AGENT,
    "--state",
    state,
    "--seq",
    nextSeq(),
  ];

  if (opts?.message) {
    args.push("--message", opts.message);
  }

  if (opts?.taskId) {
    args.push("--agent-session-id", opts.taskId);
    const resume = ["manus", "--resume", opts.taskId];
    if (opts.profile) {
      resume.push("--profile", opts.profile);
    }
    args.push("--", ...resume);
  }

  runHerdr(args);
}

export function releaseHerdr(): void {
  const ctx = envReady();
  if (!ctx) return;
  runHerdr([
    "pane",
    "release-agent",
    ctx.paneId,
    "--source",
    SOURCE,
    "--agent",
    AGENT,
    "--seq",
    nextSeq(),
  ]);
}

/** OSC 7501 fallback for herdr-core / viewers that only listen for escape sequences. */
export function emitOscStatus(state: HerdrState): void {
  if (!process.stdout.isTTY) return;
  try {
    process.stdout.write(`\x1b]7501;state=${state}:app=${AGENT}\x1b\\`);
  } catch {
    // ignore
  }
}

export function setAgentState(
  state: HerdrState,
  opts?: { message?: string; taskId?: string; profile?: string },
): void {
  emitOscStatus(state);
  reportHerdrState(state, opts);
}
