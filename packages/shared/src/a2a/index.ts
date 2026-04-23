// ─── A2A public surface (Phase 15 Track J) ───
//
// Import example:
//   import { A2AClient, buildPilotAgentCard, type AgentCard } from '@helm-pilot/shared/a2a';

export {
  A2A_PROTOCOL_VERSION,
  A2AError,
  type AgentCard,
  type AgentSkill,
  type AgentCapabilities,
  type AgentAuthentication,
  type MessageRole,
  type TextPart,
  type DataPart,
  type MessagePart,
  type A2AMessage,
  type TaskState,
  type TaskStatus,
  type Task,
  type TaskSendRequest,
  type TaskSendResponse,
  type TaskGetResponse,
} from './types.js';

export { A2AClient, type A2AClientConfig } from './client.js';
export { buildPilotAgentCard, type BuildAgentCardInput } from './card.js';
