export type AgentProfile =
  | "standard"
  | "lite"
  | "max"
  | "max-medium"
  | "max-high"
  | "max-extra"
  | "max-ultra";

export type AgentStatus = "running" | "stopped" | "waiting" | "error" | "deleted";

export interface ManusErrorBody {
  code?: string;
  message?: string;
}

export interface ApiResponse {
  ok: boolean;
  request_id?: string;
  error?: ManusErrorBody;
  [key: string]: unknown;
}

export interface CreateTaskResult extends ApiResponse {
  task_id: string;
  task_title?: string;
  task_url?: string;
  share_url?: string;
}

export interface TaskDetail extends ApiResponse {
  task: {
    id: string;
    status: AgentStatus;
    title?: string;
    task_url?: string;
    credit_usage?: number;
    agent_profile?: string;
    has_running_background_jobs?: boolean;
    created_at?: number;
    updated_at?: number;
  };
}

export interface StatusDetail {
  waiting_for_event_id?: string;
  waiting_for_event_type?: string;
  waiting_description?: string;
  confirm_input_schema?: Record<string, unknown>;
}

export interface QuestionExpectation {
  options?: string[];
  selection_mode?: "single" | "multiple";
  response_method?: string;
}

export interface TaskMessage {
  id: string;
  type: string;
  timestamp?: number;
  user_message?: {
    content?: string;
  };
  assistant_message?: {
    content?: string;
    question_expectation?: QuestionExpectation;
    delivery_kind?: string;
  };
  error_message?: {
    error_type?: string;
    content?: string;
  };
  status_update?: {
    agent_status?: AgentStatus;
    status_detail?: StatusDetail;
  };
  tool_used?: {
    tool?: string;
    brief?: string;
    description?: string;
    status?: string;
  };
}

export interface ListMessagesResult extends ApiResponse {
  task_id: string;
  messages: TaskMessage[];
  next_cursor?: string | null;
}

export interface UserMeResult extends ApiResponse {
  user_id?: string;
  name?: string;
  email?: string;
}

export interface TaskListItem {
  id: string;
  status?: AgentStatus;
  title?: string;
  task_url?: string;
  updated_at?: number;
  created_at?: number;
  credit_usage?: number;
}

export interface TaskListResult extends ApiResponse {
  data?: TaskListItem[];
  tasks?: TaskListItem[];
  next_cursor?: string | null;
  has_more?: boolean;
}

export interface WaitingInfo {
  eventId?: string;
  eventType?: string;
  description?: string;
  confirmSchema?: Record<string, unknown>;
  question?: QuestionExpectation;
  questionText?: string;
}

export interface PollOutcome {
  status: AgentStatus;
  waiting?: WaitingInfo;
  lastAssistantText?: string;
  errorText?: string;
}

export interface CliConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultProfile?: AgentProfile;
  pollIntervalMs?: number;
  interactiveMode?: boolean;
}
