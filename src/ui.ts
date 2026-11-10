import chalk from "chalk";
import ora, { type Ora } from "ora";

export const brand = chalk.hex("#5B8CFF");
export const dim = chalk.dim;
export const ok = chalk.green;
export const warn = chalk.yellow;
export const err = chalk.red;
export const accent = chalk.cyan;

export function banner(version: string): void {
  console.log(
    `${brand.bold("manus")} ${dim(`v${version}`)}  ${dim("· local Manus AI runner")}`,
  );
}

export function printAssistant(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  console.log();
  console.log(accent("manus"));
  console.log(trimmed);
  console.log();
}

export function printSystem(message: string): void {
  console.log(dim(message));
}

export function printError(message: string): void {
  console.error(err(`Error: ${message}`));
}

export function printWaiting(description: string, eventType?: string): void {
  console.log();
  console.log(warn("Needs your input"));
  if (eventType) console.log(dim(`type: ${eventType}`));
  if (description) console.log(description);
  console.log();
}

export function startSpinner(text: string): Ora {
  return ora({ text, color: "cyan", spinner: "dots" }).start();
}

export function formatTaskLine(task: {
  id: string;
  title?: string;
  status?: string;
  credit_usage?: number;
}): string {
  const title = task.title || "(untitled)";
  const status = task.status ? chalk.bold(task.status) : dim("unknown");
  const credits =
    task.credit_usage !== undefined ? dim(` · ${task.credit_usage} credits`) : "";
  return `${status.padEnd(18)} ${title} ${dim(task.id)}${credits}`;
}
