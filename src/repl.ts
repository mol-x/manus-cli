import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ManusClient } from "./client.js";
import { releaseHerdr, setAgentState } from "./herdr.js";
import { isAskWaiting, TaskSession } from "./session.js";
import type { AgentProfile, WaitingInfo } from "./types.js";
import { accent, banner, dim, printError, printSystem, warn } from "./ui.js";

export async function runRepl(
  client: ManusClient,
  opts: {
    version: string;
    profile: AgentProfile;
    interactiveMode: boolean;
    pollIntervalMs: number;
    resumeTaskId?: string;
    initialPrompt?: string;
  },
): Promise<void> {
  banner(opts.version);
  if (process.env.HERDR_ENV === "1") {
    printSystem("Herdr detected — reporting agent state");
  }
  printSystem(`Profile: ${opts.profile}  ·  type /help for commands`);
  console.log();

  const session = new TaskSession(client, {
    profile: opts.profile,
    interactiveMode: opts.interactiveMode,
    pollIntervalMs: opts.pollIntervalMs,
  });

  let pendingWait: WaitingInfo | undefined;

  const cleanup = () => {
    releaseHerdr();
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    console.log();
    process.exit(0);
  });

  setAgentState("idle", { profile: opts.profile });

  if (opts.resumeTaskId) {
    try {
      await session.attach(opts.resumeTaskId);
      const outcome = await session.pollUntilSettled();
      pendingWait = outcome.waiting;
      if (outcome.errorText) printError(outcome.errorText);
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
    }
  }

  if (opts.initialPrompt) {
    try {
      await session.send(opts.initialPrompt);
      const outcome = await session.pollUntilSettled();
      pendingWait = outcome.waiting;
      if (outcome.errorText) printError(outcome.errorText);
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
    }
  }

  const rl = readline.createInterface({ input, output, terminal: true });

  const promptLabel = () =>
    session.taskId ? accent("you") + dim(` (${session.taskId.slice(0, 8)})`) + "> " : accent("you") + "> ";

  try {
    for (;;) {
      setAgentState(pendingWait ? "blocked" : "idle", {
        taskId: session.taskId || undefined,
        profile: session.profile,
        message: pendingWait?.description,
      });

      let line: string;
      try {
        line = (await rl.question(promptLabel())).trim();
      } catch {
        break;
      }

      if (!line) continue;

      if (line === "/exit" || line === "/quit") break;

      if (line === "/help") {
        printHelp();
        continue;
      }

      if (line === "/status") {
        if (!session.taskId) {
          printSystem("No active task.");
          continue;
        }
        try {
          const detail = await client.taskDetail(session.taskId);
          printSystem(
            [
              `id: ${detail.task.id}`,
              `title: ${detail.task.title || "(none)"}`,
              `status: ${detail.task.status}`,
              `profile: ${detail.task.agent_profile || session.profile}`,
              detail.task.credit_usage !== undefined ? `credits: ${detail.task.credit_usage}` : null,
              detail.task.task_url ? `url: ${detail.task.task_url}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          );
        } catch (error) {
          printError(error instanceof Error ? error.message : String(error));
        }
        continue;
      }

      if (line === "/url") {
        printSystem(session.taskUrl || "No task URL yet.");
        continue;
      }

      if (line === "/clear") {
        session.taskId = null;
        session.taskUrl = null;
        session.title = null;
        pendingWait = undefined;
        setAgentState("idle", { profile: session.profile });
        printSystem("Started a fresh conversation. Next message creates a new task.");
        continue;
      }

      if (line.startsWith("/profile ")) {
        const value = line.slice("/profile ".length).trim();
        try {
          const { resolveProfile } = await import("./config.js");
          session.profile = resolveProfile(value);
          printSystem(`Profile set to ${session.profile}`);
        } catch (error) {
          printError(error instanceof Error ? error.message : String(error));
        }
        continue;
      }

      if (line === "/yes" || line === "/no") {
        if (!pendingWait?.eventId || isAskWaiting(pendingWait)) {
          printSystem("Nothing to confirm. For questions, type your answer as a normal message.");
          continue;
        }
        try {
          const accept = line === "/yes";
          await session.confirm(pendingWait.eventId, { accept });
          pendingWait = undefined;
          const outcome = await session.pollUntilSettled();
          pendingWait = outcome.waiting;
          if (outcome.errorText) printError(outcome.errorText);
        } catch (error) {
          printError(error instanceof Error ? error.message : String(error));
        }
        continue;
      }

      if (line.startsWith("/")) {
        printSystem(`Unknown command: ${line}. Try /help`);
        continue;
      }

      try {
        // If waiting on an action confirmation and the user types free text,
        // sendMessage will skip the pending action (Manus API behavior).
        if (pendingWait?.eventId && !isAskWaiting(pendingWait) && line) {
          printSystem(warn("Sending a message while a confirmation is pending skips that action."));
        }

        await session.send(line);
        pendingWait = undefined;
        const outcome = await session.pollUntilSettled();
        pendingWait = outcome.waiting;
        if (outcome.errorText) printError(outcome.errorText);
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    rl.close();
    cleanup();
  }
}

function printHelp(): void {
  console.log(`
${dim("Commands")}
  /help              Show this help
  /status            Show current task details
  /url               Print Manus webapp URL
  /profile <name>    Switch profile (standard|lite|max|max-*)
  /yes               Approve a pending confirmation
  /no                Reject a pending confirmation
  /clear             Start a new task on next message
  /exit              Quit

${dim("Tips")}
  One-shot:          manus -p "your prompt"
  Resume:            manus --resume <task_id>
  Inside Herdr:      just run manus — state shows in the sidebar
`);
}

export async function runOnce(
  client: ManusClient,
  opts: {
    prompt: string;
    profile: AgentProfile;
    interactiveMode: boolean;
    pollIntervalMs: number;
    resumeTaskId?: string;
  },
): Promise<number> {
  const session = new TaskSession(client, {
    profile: opts.profile,
    interactiveMode: opts.interactiveMode,
    pollIntervalMs: opts.pollIntervalMs,
  });

  const cleanup = () => releaseHerdr();
  process.on("exit", cleanup);

  try {
    if (opts.resumeTaskId) {
      await session.attach(opts.resumeTaskId);
      await session.send(opts.prompt);
    } else {
      await session.create(opts.prompt);
    }

    const outcome = await session.pollUntilSettled();
    if (outcome.status === "waiting") {
      printSystem("Task is waiting for input. Resume with:");
      printSystem(`  manus --resume ${session.taskId}`);
      setAgentState("blocked", {
        taskId: session.taskId || undefined,
        profile: opts.profile,
        message: outcome.waiting?.description,
      });
      return 2;
    }
    if (outcome.status === "error") {
      printError(outcome.errorText || "Task failed");
      return 1;
    }
    setAgentState("idle", { taskId: session.taskId || undefined, profile: opts.profile });
    return 0;
  } finally {
    cleanup();
  }
}
