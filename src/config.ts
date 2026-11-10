import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentProfile, CliConfig } from "./types.js";

const CONFIG_DIR = join(homedir(), ".config", "manus-cli");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const DEFAULTS: Required<
  Pick<CliConfig, "baseUrl" | "defaultProfile" | "pollIntervalMs" | "interactiveMode">
> = {
  baseUrl: "https://api.manus.ai",
  defaultProfile: "standard",
  pollIntervalMs: 2000,
  interactiveMode: true,
};

export function configPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): CliConfig {
  let fileConfig: CliConfig = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      fileConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as CliConfig;
    } catch {
      fileConfig = {};
    }
  }

  return {
    ...DEFAULTS,
    ...fileConfig,
    apiKey: process.env.MANUS_API_KEY || fileConfig.apiKey,
    baseUrl: process.env.MANUS_BASE_URL || fileConfig.baseUrl || DEFAULTS.baseUrl,
  };
}

export function saveConfig(partial: CliConfig): CliConfig {
  const current = loadConfig();
  const next: CliConfig = {
    ...current,
    ...partial,
  };
  // Never persist env-only overrides into the file as empty values.
  const toWrite: CliConfig = { ...next };
  if (!partial.apiKey && process.env.MANUS_API_KEY) {
    // Keep previously saved key if we're only updating other fields via env.
    toWrite.apiKey = current.apiKey;
  }
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(toWrite, null, 2)}\n`, { mode: 0o600 });
  return loadConfig();
}

export function requireApiKey(config = loadConfig()): string {
  if (!config.apiKey) {
    throw new Error(
      "No Manus API key found. Run `manus auth login` or set MANUS_API_KEY.\n" +
        "Create a key at https://manus.im (Developers → API keys).",
    );
  }
  return config.apiKey;
}

export function resolveProfile(value?: string, fallback?: AgentProfile): AgentProfile {
  const raw = (value || fallback || DEFAULTS.defaultProfile).trim().toLowerCase();
  const aliases: Record<string, AgentProfile> = {
    standard: "standard",
    "manus-1.6": "standard",
    "1.6": "standard",
    lite: "lite",
    "manus-1.6-lite": "lite",
    "1.6-lite": "lite",
    max: "max",
    "manus-1.6-max": "max",
    "max-medium": "max-medium",
    "max-high": "max-high",
    "max-extra": "max-extra",
    "max-ultra": "max-ultra",
  };
  const profile = aliases[raw];
  if (!profile) {
    throw new Error(
      `Unknown profile "${value}". Use: standard, lite, max, max-medium, max-high, max-extra, max-ultra`,
    );
  }
  return profile;
}
