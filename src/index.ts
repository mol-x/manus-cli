#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ManusClient, ManusApiError } from "./client.js";
import { configPath, loadConfig, requireApiKey, resolveProfile, saveConfig } from "./config.js";
import { runOnce, runRepl } from "./repl.js";
import { formatTaskLine, ok, printError, printSystem } from "./ui.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as {
  version: string;
};

async function promptHidden(question: string): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    const rl = createInterface({ input, output });
    const answer = await rl.question(question);
    rl.close();
    return answer.trim();
  }

  output.write(question);
  return await new Promise((resolve) => {
    const wasRaw = input.isRaw;
    const chunks: Buffer[] = [];
    input.setRawMode(true);
    input.resume();
    const onData = (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      if (s === "\n" || s === "\r" || s === "\u0004") {
        input.setRawMode(!!wasRaw);
        input.pause();
        input.off("data", onData);
        output.write("\n");
        resolve(Buffer.concat(chunks).toString("utf8").trim());
        return;
      }
      if (s === "\u0003") {
        input.setRawMode(!!wasRaw);
        process.exit(130);
      }
      if (s === "\u007f") {
        if (chunks.length) {
          chunks.pop();
          output.write("\b \b");
        }
        return;
      }
      chunks.push(Buffer.from(s));
      output.write("*");
    };
    input.on("data", onData);
  });
}

function handleError(error: unknown): never {
  if (error instanceof ManusApiError) {
    printError(
      [error.message, error.code ? `(${error.code})` : null, error.requestId ? `request ${error.requestId}` : null]
        .filter(Boolean)
        .join(" "),
    );
  } else {
    printError(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
}

const program = new Command();

program
  .name("manus")
  .description("Local Manus AI agent runner (Claude/Cursor-style CLI + Herdr)")
  .version(pkg.version)
  .option("-p, --print <prompt>", "One-shot prompt (non-interactive)")
  .option("-r, --resume <taskId>", "Resume an existing Manus task")
  .option("--profile <name>", "Agent profile: standard|lite|max|max-*")
  .option("--no-interactive", "Disable interactive follow-up questions")
  .option("--poll-interval <ms>", "Polling interval in ms", (v) => Number(v))
  .argument("[prompt...]", "Optional prompt; opens REPL afterward unless --print is used")
  .action(async (promptParts: string[], opts) => {
    try {
      const config = loadConfig();
      requireApiKey(config);
      const client = new ManusClient();
      const profile = resolveProfile(opts.profile, config.defaultProfile);
      const interactiveMode = opts.interactive ?? config.interactiveMode ?? true;
      const pollIntervalMs = opts.pollInterval || config.pollIntervalMs || 2000;
      const joined = promptParts.join(" ").trim();
      const oneShot = opts.print as string | undefined;

      if (oneShot) {
        const code = await runOnce(client, {
          prompt: oneShot,
          profile,
          interactiveMode,
          pollIntervalMs,
          resumeTaskId: opts.resume,
        });
        process.exit(code);
      }

      await runRepl(client, {
        version: pkg.version,
        profile,
        interactiveMode,
        pollIntervalMs,
        resumeTaskId: opts.resume,
        initialPrompt: joined || undefined,
      });
    } catch (error) {
      handleError(error);
    }
  });

const auth = program.command("auth").description("Manage Manus API authentication");

auth
  .command("login")
  .description("Save your Manus API key")
  .option("--key <apiKey>", "API key (otherwise prompted)")
  .action(async (opts: { key?: string }) => {
    try {
      const key = opts.key || (await promptHidden("Paste Manus API key: "));
      if (!key) {
        printError("API key required");
        process.exit(1);
      }
      const client = new ManusClient({ apiKey: key });
      const me = await client.me();
      saveConfig({ apiKey: key });
      console.log(ok(`Authenticated${me.name ? ` as ${me.name}` : me.email ? ` as ${me.email}` : ""}.`));
      printSystem(`Saved to ${configPath()}`);
    } catch (error) {
      handleError(error);
    }
  });

auth
  .command("logout")
  .description("Remove the saved API key")
  .action(() => {
    if (existsSync(configPath())) {
      try {
        const raw = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
        delete raw.apiKey;
        writeFileSync(configPath(), `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
      } catch {
        writeFileSync(configPath(), "{}\n", { mode: 0o600 });
      }
    }
    console.log(ok("Logged out."));
  });

auth
  .command("status")
  .description("Show authentication status")
  .action(async () => {
    try {
      const config = loadConfig();
      if (!config.apiKey) {
        printSystem("Not authenticated. Run `manus auth login` or set MANUS_API_KEY.");
        process.exit(1);
      }
      const source = process.env.MANUS_API_KEY ? "MANUS_API_KEY" : configPath();
      const client = new ManusClient();
      const me = await client.me();
      console.log(ok("Authenticated"));
      if (me.name) printSystem(`name:  ${me.name}`);
      if (me.email) printSystem(`email: ${me.email}`);
      if (me.user_id) printSystem(`id:    ${me.user_id}`);
      printSystem(`key:   ${source}`);
    } catch (error) {
      handleError(error);
    }
  });

const task = program.command("task").description("Manage Manus tasks");

task
  .command("list")
  .description("List recent tasks")
  .option("-n, --limit <n>", "Number of tasks", (v) => Number(v), 20)
  .action(async (opts: { limit: number }) => {
    try {
      const client = new ManusClient();
      const result = await client.listTasks({ limit: opts.limit });
      const tasks = result.data || result.tasks || [];
      if (!tasks.length) {
        printSystem("No tasks found.");
        return;
      }
      for (const t of tasks) {
        console.log(formatTaskLine(t));
      }
    } catch (error) {
      handleError(error);
    }
  });

task
  .command("get")
  .argument("<taskId>")
  .description("Show task details")
  .action(async (taskId: string) => {
    try {
      const client = new ManusClient();
      const detail = await client.taskDetail(taskId);
      console.log(JSON.stringify(detail.task, null, 2));
    } catch (error) {
      handleError(error);
    }
  });

task
  .command("delete")
  .argument("<taskId>")
  .description("Delete a task")
  .action(async (taskId: string) => {
    try {
      const client = new ManusClient();
      await client.deleteTask(taskId);
      console.log(ok(`Deleted ${taskId}`));
    } catch (error) {
      handleError(error);
    }
  });

const configCmd = program.command("config").description("Show or set local config");

configCmd
  .command("show")
  .description("Show effective config (API key redacted)")
  .action(() => {
    const config = loadConfig();
    const redacted = {
      ...config,
      apiKey: config.apiKey ? `${config.apiKey.slice(0, 6)}…` : undefined,
    };
    console.log(JSON.stringify(redacted, null, 2));
    printSystem(`file: ${configPath()}`);
  });

configCmd
  .command("set")
  .argument("<key>")
  .argument("<value>")
  .description("Set a config value (defaultProfile, pollIntervalMs, interactiveMode, baseUrl)")
  .action((key: string, value: string) => {
    const allowed = new Set(["defaultProfile", "pollIntervalMs", "interactiveMode", "baseUrl"]);
    if (!allowed.has(key)) {
      printError(`Unsupported key. Use: ${[...allowed].join(", ")}`);
      process.exit(1);
    }
    let parsed: string | number | boolean = value;
    if (key === "pollIntervalMs") parsed = Number(value);
    if (key === "interactiveMode") parsed = value === "true" || value === "1";
    if (key === "defaultProfile") parsed = resolveProfile(value);
    saveConfig({ [key]: parsed });
    console.log(ok(`Set ${key}`));
  });

program
  .command("whoami")
  .description("Show the authenticated Manus user")
  .action(async () => {
    try {
      const client = new ManusClient();
      const me = await client.me();
      console.log(JSON.stringify(me, null, 2));
    } catch (error) {
      handleError(error);
    }
  });

await program.parseAsync(process.argv);
