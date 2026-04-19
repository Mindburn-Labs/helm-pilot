/**
 * HELM governance client types.
 *
 * These types mirror what helm-oss v0.3.0 exposes via:
 *   - POST /v1/chat/completions   → LLM call with Guardian enforcement
 *   - GET  /healthz               → health
 *   - GET  /api/v1/version        → version
 *
 * When helm-oss grows a generic `POST /api/v1/guardian/evaluate` endpoint, the
 * `evaluate()` method in `HelmClient` will use it. Until then `evaluate()` is
 * only wired for LLM inference via the chat completion path.
 */

/** CPI verdict — matches helm-oss `core/pkg/contracts/verdict.go`. */
export type HelmVerdict = 'ALLOW' | 'DENY' | 'ESCALATE';

/**
 * Receipt attached to every HELM governance decision.
 *
 * For chat completions the fields are parsed from response headers:
 *   X-Helm-Decision-ID    → decisionId
 *   X-Helm-Verdict        → verdict
 *   X-Helm-Policy-Version → policyVersion
 *   X-Helm-Decision-Hash  → decisionHash
 */
export interface HelmReceipt {
  decisionId: string;
  verdict: HelmVerdict;
  policyVersion: string;
  decisionHash?: string;
  /** Wall-clock capture time in the client. Useful for replay when HELM didn't emit one. */
  receivedAt: Date;
  /** The action recorded in the decision request (e.g. 'LLM_INFERENCE'). */
  action: string;
  /** The resource — model name for LLM, tool name for tool calls. */
  resource: string;
  /** Principal presented to HELM. */
  principal: string;
  /** Optional human-readable reason populated on DENY/ESCALATE. */
  reason?: string;
}

export interface HealthSnapshot {
  gatewayOk: boolean;
  version?: string;
  latencyMs: number;
  checkedAt: Date;
  /** Only populated when gatewayOk is false. */
  error?: string;
}

/**
 * Chat completion request — matches the OpenAI Chat Completions schema that
 * HELM proxies at `POST /v1/chat/completions`.
 */
export interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    tool_call_id?: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: false;
  [key: string]: unknown;
}

export interface ChatCompletionResult {
  /** Raw OpenAI-shaped response body (choices, usage, id, model, etc.). */
  body: ChatCompletionBody;
  /** Governance receipt parsed from the response headers. */
  receipt: HelmReceipt;
}

export interface ChatCompletionBody {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Generic governance evaluation request. Not yet callable against helm-oss
 * v0.3.0 — reserved for the upstream `POST /api/v1/guardian/evaluate` endpoint.
 */
export interface EvaluateRequest {
  principal: string;
  action: string;
  resource: string;
  context?: Record<string, unknown>;
}

export interface EvaluateResult {
  receipt: HelmReceipt;
  /** Evidence pack identifier (when HELM is configured to persist them). */
  evidencePackId?: string;
}

export interface HelmClientConfig {
  /** Base URL of HELM's governed API, e.g. http://helm:8080 */
  baseUrl: string;
  /** Base URL of HELM's health server, e.g. http://helm:8081 */
  healthUrl?: string;
  /** Default principal if not supplied per-call (e.g. 'workspace:abc/operator:engineering'). */
  defaultPrincipal?: string;
  /** Admin API key injected as Authorization: Bearer … for admin endpoints. */
  adminApiKey?: string;
  /** Per-request timeout in ms. Defaults to 30000. */
  timeoutMs?: number;
  /** Max attempts per governed call (including the first). Defaults to 3. */
  maxRetries?: number;
  /**
   * Phase 13.5 — opt in to the real `POST /api/v1/guardian/evaluate`
   * endpoint once helm-oss v0.3.1+ ships it. When false/undefined the
   * client's `evaluate()` method fails closed with HelmNotImplementedError.
   */
  evaluateEnabled?: boolean;
  /** Base backoff in ms for exponential retry. Defaults to 100. */
  baseBackoffMs?: number;
  /** Fail closed when true (default): any non-200 / non-403 error denies the call. */
  failClosed?: boolean;
  /** Optional fetch implementation for tests. */
  fetchImpl?: typeof fetch;
  /** Optional receipt callback (e.g. persist to evidence_packs table). */
  onReceipt?: (receipt: HelmReceipt) => void | Promise<void>;
}

// ─── Phase 14 Track F — helm-oss endpoint response shapes ───
// These types mirror the helm-oss HTTP endpoint payloads Pilot consumes.

export interface Soc2BundleResult {
  /** JCS-canonical bundle, base64-encoded tar.gz for transport. */
  bundleBase64: string;
  manifestHash: string;
  generatedAt: string;
}

export interface MerkleRootResult {
  root: string;
  generatedAt: string;
}

export interface BudgetStatusResult {
  enforcer: string;
  status: 'active' | 'degraded' | 'unconfigured';
  dailyRemainingUsd?: number;
  dailyLimitUsd?: number;
  monthlyRemainingUsd?: number;
  monthlyLimitUsd?: number;
  alerts?: Array<{ level: 'info' | 'warn' | 'critical'; message: string }>;
}

export interface ObligationRequest {
  workspaceId: string;
  decisionId: string;
  obligation: string;
  retentionDays?: number;
  metadata?: Record<string, unknown>;
}

export interface ObligationResult {
  obligationId: string;
  registeredAt: string;
  expiresAt?: string;
}

export interface BoundaryCheckResult {
  ok: boolean;
  violations: Array<{ kind: string; detail: string; severity: 'warn' | 'critical' }>;
  checkedAt: string;
}

export interface MemoryEntry {
  id: string;
  scope: 'workspace' | 'shared';
  title: string;
  createdAt: string;
  checksum: string;
}

export interface MemoryListResult {
  entries: MemoryEntry[];
  nextCursor?: string;
}

export interface MemoryPromoteResult {
  sharedMemoryId: string;
  promotedAt: string;
}

export interface ContextBundle {
  id: string;
  name: string;
  size: number;
  checksum: string;
  createdAt: string;
}

export interface ContextBundleListResult {
  bundles: ContextBundle[];
}

export interface EconomicCharge {
  id: string;
  workspaceId: string;
  centerLabel?: string;
  amountUsd: number;
  currency: string;
  occurredAt: string;
  reason?: string;
}

export interface EconomicChargesResult {
  charges: EconomicCharge[];
  totalUsd: number;
  window: { from: string; to: string };
}

export interface EconomicAllocation {
  workspaceId: string;
  allocatedUsd: number;
  consumedUsd: number;
  window: { from: string; to: string };
}

export interface EconomicAllocationsResult {
  allocations: EconomicAllocation[];
}
