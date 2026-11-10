import type { ManusClient } from "./client.js";
import { setAgentState } from "./herdr.js";
import type { AgentProfile, AgentStatus, PollOutcome, TaskMessage, WaitingInfo } from "./types.js";
import { printAssistant, printSystem, printWaiting, startSpinner } from "./ui.js";

const ASK_TYPES = new Set(["messageAskUser", "cascadeAskUser"]);

function extractText(msg: TaskMessage): string | undefined {
  if (msg.assistant_message?.content) return msg.assistant_message.content;
  if (msg.error_message?.content) return msg.error_message.content;
  return undefined;
}

function isAsk(eventType?: string): boolean {
  return !!eventType && ASK_TYPES.has(eventType);
}

export class TaskSession {
  taskId: string | null = null;
  taskUrl: string | null = null;
  title: string | null = null;
  profile: AgentProfile;
  private seenIds = new Set<string>();
  private lastStatus: AgentStatus | null = null;

  constructor(
    private readonly client: ManusClient,
    opts: { profile: AgentProfile; interactiveMode?: boolean; pollIntervalMs?: number },
  ) {
    this.profile = opts.profile;
    this.interactiveMode = opts.interactiveMode ?? true;
    this.pollIntervalMs = opts.pollIntervalMs ?? 2000;
  }

  readonly interactiveMode: boolean;
  readonly pollIntervalMs: number;

  async create(prompt: string): Promise<void> {
    setAgentState("working", { profile: this.profile });
    const created = await this.client.createTask({
      content: prompt,
      agentProfile: this.profile,
      interactiveMode: this.interactiveMode,
    });
    this.taskId = created.task_id;
    this.taskUrl = created.task_url ?? null;
    this.title = created.task_title ?? null;
    setAgentState("working", { taskId: this.taskId, profile: this.profile });
    if (this.taskUrl) printSystem(`Task: ${this.taskUrl}`);
  }

  async attach(taskId: string): Promise<void> {
    const detail = await this.client.taskDetail(taskId);
    this.taskId = detail.task.id;
    this.taskUrl = detail.task.task_url ?? null;
    this.title = detail.task.title ?? null;
    setAgentState("working", { taskId: this.taskId, profile: this.profile });
    printSystem(`Resumed ${this.title || this.taskId}`);
    if (this.taskUrl) printSystem(`Task: ${this.taskUrl}`);

    // Mark existing messages as seen so we only stream new ones.
    const history = await this.client.listMessages({
      taskId: this.taskId,
      order: "asc",
      limit: 100,
    });
    for (const msg of history.messages || []) {
      this.seenIds.add(msg.id);
      const text = extractText(msg);
      if (msg.type === "assistant_message" && text) {
        printAssistant(text);
      }
    }
  }

  async send(prompt: string): Promise<void> {
    if (!this.taskId) {
      await this.create(prompt);
      return;
    }
    setAgentState("working", { taskId: this.taskId, profile: this.profile });
    await this.client.sendMessage({
      taskId: this.taskId,
      content: prompt,
      agentProfile: this.profile,
    });
  }

  async confirm(eventId: string, data?: Record<string, unknown>): Promise<void> {
    if (!this.taskId) throw new Error("No active task");
    setAgentState("working", { taskId: this.taskId, profile: this.profile });
    await this.client.confirmAction({
      taskId: this.taskId,
      eventId,
      data,
    });
  }

  async pollUntilSettled(opts?: {
    quiet?: boolean;
    onAssistant?: (text: string) => void;
  }): Promise<PollOutcome> {
    if (!this.taskId) throw new Error("No active task");

    const spinner = opts?.quiet
      ? null
      : startSpinner("Manus is working…");

    try {
      for (;;) {
        const page = await this.client.listMessages({
          taskId: this.taskId,
          order: "asc",
          limit: 50,
        });

        let waiting: WaitingInfo | undefined;
        let lastAssistantText: string | undefined;
        let errorText: string | undefined;
        let status: AgentStatus = this.lastStatus || "running";

        for (const msg of page.messages || []) {
          const isNew = !this.seenIds.has(msg.id);
          if (isNew) this.seenIds.add(msg.id);

          if (msg.type === "status_update" && msg.status_update?.agent_status) {
            status = msg.status_update.agent_status;
            this.lastStatus = status;
            const detail = msg.status_update.status_detail;
            if (status === "waiting") {
              waiting = {
                eventId: detail?.waiting_for_event_id,
                eventType: detail?.waiting_for_event_type,
                description: detail?.waiting_description,
                confirmSchema: detail?.confirm_input_schema,
              };
            }
          }

          if (msg.type === "assistant_message") {
            const text = extractText(msg);
            if (text) {
              lastAssistantText = text;
              if (isNew) {
                spinner?.stop();
                if (opts?.onAssistant) opts.onAssistant(text);
                else printAssistant(text);
                spinner?.start("Manus is working…");
              }
              if (msg.assistant_message?.question_expectation) {
                waiting = {
                  ...(waiting || {}),
                  question: msg.assistant_message.question_expectation,
                  questionText: text,
                  eventType: waiting?.eventType || "messageAskUser",
                };
              }
            }
          }

          if (msg.type === "error_message") {
            errorText = extractText(msg) || "Task error";
            if (isNew) {
              spinner?.stop();
              printSystem(`Error event: ${errorText}`);
              spinner?.start("Manus is working…");
            }
          }

          if (msg.type === "tool_used" && isNew && msg.tool_used?.brief && spinner) {
            spinner.text = msg.tool_used.brief;
          }
        }

        // Prefer task.detail for authoritative status.
        const detail = await this.client.taskDetail(this.taskId);
        status = detail.task.status;
        this.lastStatus = status;
        if (detail.task.title) this.title = detail.task.title;
        if (detail.task.task_url) this.taskUrl = detail.task.task_url;

        if (status === "running") {
          setAgentState("working", { taskId: this.taskId, profile: this.profile });
          await sleep(this.pollIntervalMs);
          continue;
        }

        spinner?.stop();

        if (status === "waiting") {
          // Refresh waiting info from the newest status_update if needed.
          if (!waiting) {
            const recent = await this.client.listMessages({
              taskId: this.taskId,
              order: "desc",
              limit: 20,
            });
            for (const msg of recent.messages || []) {
              if (msg.type === "status_update" && msg.status_update?.agent_status === "waiting") {
                const d = msg.status_update.status_detail;
                waiting = {
                  eventId: d?.waiting_for_event_id,
                  eventType: d?.waiting_for_event_type,
                  description: d?.waiting_description,
                  confirmSchema: d?.confirm_input_schema,
                };
                break;
              }
              if (msg.type === "assistant_message" && msg.assistant_message?.question_expectation) {
                waiting = {
                  question: msg.assistant_message.question_expectation,
                  questionText: msg.assistant_message.content,
                  eventType: "messageAskUser",
                };
                break;
              }
            }
          }

          const message =
            waiting?.description ||
            waiting?.questionText ||
            waiting?.eventType ||
            "Waiting for confirmation";
          setAgentState("blocked", {
            taskId: this.taskId,
            profile: this.profile,
            message,
          });
          if (!opts?.quiet) {
            printWaiting(message, waiting?.eventType);
            if (waiting?.question?.options?.length) {
              printSystem(
                `Options (${waiting.question.selection_mode || "single"}): ${waiting.question.options.join(", ")}`,
              );
            }
            if (waiting?.confirmSchema && !isAsk(waiting.eventType)) {
              printSystem("Reply /yes to approve, /no to skip, or type a message.");
            }
          }
          return { status, waiting, lastAssistantText, errorText };
        }

        if (status === "error") {
          setAgentState("idle", { taskId: this.taskId, profile: this.profile });
          return { status, lastAssistantText, errorText: errorText || "Task failed" };
        }

        // stopped
        if (detail.task.has_running_background_jobs) {
          setAgentState("working", { taskId: this.taskId, profile: this.profile });
          spinner?.start("Background jobs still running…");
          await sleep(this.pollIntervalMs);
          continue;
        }

        setAgentState("idle", { taskId: this.taskId, profile: this.profile });
        return { status, lastAssistantText, errorText };
      }
    } catch (error) {
      spinner?.stop();
      setAgentState("idle", {
        taskId: this.taskId || undefined,
        profile: this.profile,
      });
      throw error;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isAskWaiting(waiting?: WaitingInfo): boolean {
  return isAsk(waiting?.eventType) || !!waiting?.question;
}
