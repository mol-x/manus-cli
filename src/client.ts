import { loadConfig, requireApiKey } from "./config.js";
import type {
  AgentProfile,
  ApiResponse,
  CreateTaskResult,
  ListMessagesResult,
  TaskDetail,
  TaskListResult,
  UserMeResult,
} from "./types.js";

export class ManusApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly requestId?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ManusApiError";
  }
}

export class ManusClient {
  readonly apiKey: string;
  readonly baseUrl: string;

  constructor(opts?: { apiKey?: string; baseUrl?: string }) {
    const config = loadConfig();
    this.apiKey = opts?.apiKey || requireApiKey(config);
    this.baseUrl = (opts?.baseUrl || config.baseUrl || "https://api.manus.ai").replace(/\/$/, "");
  }

  private headers(): HeadersInit {
    return {
      "Content-Type": "application/json",
      "x-manus-api-key": this.apiKey,
      "User-Agent": "manus-cli/@mol-x",
    };
  }

  private async request<T extends ApiResponse>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let data: T;
    try {
      data = (await res.json()) as T;
    } catch {
      throw new ManusApiError(`Invalid JSON response (HTTP ${res.status})`, undefined, undefined, res.status);
    }

    if (!res.ok || data.ok === false) {
      throw new ManusApiError(
        data.error?.message || `Manus API error (HTTP ${res.status})`,
        data.error?.code,
        data.request_id,
        res.status,
      );
    }

    return data;
  }

  me(): Promise<UserMeResult> {
    return this.request<UserMeResult>("GET", "/v2/user.me");
  }

  createTask(input: {
    content: string;
    agentProfile?: AgentProfile;
    interactiveMode?: boolean;
    projectId?: string;
    title?: string;
    locale?: string;
  }): Promise<CreateTaskResult> {
    return this.request<CreateTaskResult>("POST", "/v2/task.create", {
      message: { content: input.content },
      agent_profile: input.agentProfile,
      interactive_mode: input.interactiveMode ?? true,
      project_id: input.projectId,
      title: input.title,
      locale: input.locale,
    });
  }

  sendMessage(input: {
    taskId: string;
    content: string;
    agentProfile?: AgentProfile;
  }): Promise<ApiResponse & { task_id?: string }> {
    return this.request("POST", "/v2/task.sendMessage", {
      task_id: input.taskId,
      message: { content: input.content },
      agent_profile: input.agentProfile,
    });
  }

  confirmAction(input: {
    taskId: string;
    eventId: string;
    data?: Record<string, unknown>;
  }): Promise<ApiResponse & { confirmed?: boolean }> {
    return this.request("POST", "/v2/task.confirmAction", {
      task_id: input.taskId,
      event_id: input.eventId,
      input: input.data,
    });
  }

  listMessages(input: {
    taskId: string;
    order?: "asc" | "desc";
    limit?: number;
    cursor?: string;
    verbose?: boolean;
    startEventId?: string;
  }): Promise<ListMessagesResult> {
    return this.request<ListMessagesResult>("GET", "/v2/task.listMessages", undefined, {
      task_id: input.taskId,
      order: input.order ?? "asc",
      limit: input.limit ?? 50,
      cursor: input.cursor,
      verbose: input.verbose,
      start_event_id: input.startEventId,
    });
  }

  taskDetail(taskId: string): Promise<TaskDetail> {
    return this.request<TaskDetail>("GET", "/v2/task.detail", undefined, { task_id: taskId });
  }

  listTasks(input?: { limit?: number; cursor?: string }): Promise<TaskListResult> {
    return this.request<TaskListResult>("GET", "/v2/task.list", undefined, {
      limit: input?.limit ?? 20,
      cursor: input?.cursor,
    });
  }

  deleteTask(taskId: string): Promise<ApiResponse> {
    return this.request("POST", "/v2/task.delete", { task_id: taskId });
  }
}
