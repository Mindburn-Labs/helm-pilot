// ─── A2A protocol types (Phase 15 Track J) ───
//
// Minimal TS surface for the Agent2Agent (A2A) protocol v0.3 — the
// Linux-Foundation cross-agent lingua franca donated by Google.
// Pilot implements the subset needed to be addressable by Microsoft
// Agent Framework, Gemini CLI, and other A2A clients:
//
//   1. Agent card at /.well-known/agent-card.json
//   2. Task lifecycle (send, get, cancel) via JSON-RPC 2.0 over HTTPS
//   3. Message shape with text + data parts
//
// Reference: https://a2a-protocol.org/latest/specification/
// Donated to Linux Foundation in 2026. Note: A2A is Pilot-as-server;
// MCP (Phase 14 Track A) is Pilot-as-tool-host. Different shapes.

export const A2A_PROTOCOL_VERSION = '0.3.0';

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
}

export interface AgentAuthentication {
  schemes: Array<'none' | 'bearer' | 'oauth2'>;
  oauthMetadataUrl?: string;
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  protocolVersion: string;
  version: string;
  capabilities: AgentCapabilities;
  authentication: AgentAuthentication;
  skills: AgentSkill[];
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  provider?: {
    organization: string;
    url?: string;
  };
}

export type MessageRole = 'user' | 'agent';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface DataPart {
  type: 'data';
  data: unknown;
  mimeType?: string;
}

export type MessagePart = TextPart | DataPart;

export interface A2AMessage {
  role: MessageRole;
  parts: MessagePart[];
  messageId?: string;
}

export type TaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed';

export interface TaskStatus {
  state: TaskState;
  message?: A2AMessage;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

export interface Task {
  id: string;
  status: TaskStatus;
  history?: A2AMessage[];
  artifacts?: Array<{
    name: string;
    parts: MessagePart[];
  }>;
}

export interface TaskSendRequest {
  id?: string;
  message: A2AMessage;
  sessionId?: string;
}

export interface TaskSendResponse {
  task: Task;
}

export interface TaskGetResponse {
  task: Task;
}

export class A2AError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_configured'
      | 'transport_error'
      | 'auth_error'
      | 'unknown_method'
      | 'invalid_request'
      | 'task_not_found'
      | 'protocol_error' = 'unknown_method',
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'A2AError';
  }
}
