import {
  trace,
  SpanKind,
  SpanStatusCode,
  type Span,
  type Tracer,
  type Attributes,
} from '@opentelemetry/api';

// ─── OpenTelemetry GenAI semantic conventions (April 2026) ───
//
// https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
//
// Operation names:
//   invoke_agent   — one iteration of an agent loop
//   execute_tool   — one tool invocation inside an iteration
//   chat           — one LLM chat completion
//
// Attribute set:
//   gen_ai.operation.name       — one of the three above
//   gen_ai.agent.name           — operator role / subagent name
//   gen_ai.conversation.id      — taskId (threads iterations + tools)
//   gen_ai.request.model        — e.g. "anthropic/claude-sonnet-4"
//   gen_ai.usage.input_tokens   — cumulative input tokens this call
//   gen_ai.usage.output_tokens  — cumulative output tokens this call
//   gen_ai.response.id          — upstream response ID if the model provides one
//
// HELM-specific attributes (additive):
//   helm.evidence_pack.id       — row id of the emitted evidence pack
//   helm.verdict                — ALLOW | DENY | ESCALATE
//   helm.policy.version         — policy bundle hash
//   helm.tool.name              — tool registry key (e.g. "search_yc")
//   helm.subagent.name          — when inside a subagent, its registry name
//
// When no SDK is registered (no OTEL_EXPORTER_OTLP_ENDPOINT configured,
// no @opentelemetry/sdk-node package installed), `trace.getTracer()`
// returns a no-op tracer and all wrappers become pass-throughs with zero
// runtime overhead.

const TRACER_NAME = '@pilot/orchestrator';
const TRACER_VERSION = '0.1.0';

function agentTracer(): Tracer {
  return trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

export interface AgentSpanAttributes {
  agentName: string;
  conversationId: string; // taskId
  model?: string;
  subagentName?: string;
}

/**
 * Wrap one agent-loop iteration (plan + execute one action). Produces an
 * `invoke_agent` span; inner tool/chat calls become child spans via OTel
 * context propagation.
 */
export async function withAgentSpan<T>(
  attrs: AgentSpanAttributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = agentTracer();
  const spanName = `invoke_agent ${attrs.agentName}`;
  return tracer.startActiveSpan(
    spanName,
    {
      kind: SpanKind.INTERNAL,
      attributes: toAttributes({
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.agent.name': attrs.agentName,
        'gen_ai.conversation.id': attrs.conversationId,
        'gen_ai.request.model': attrs.model,
        'helm.subagent.name': attrs.subagentName,
      }),
    },
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

export interface ToolSpanAttributes {
  toolName: string;
  conversationId: string;
}

/**
 * Wrap a single tool invocation — producing an `execute_tool` span nested
 * inside the current iteration span.
 */
export async function withToolSpan<T>(
  attrs: ToolSpanAttributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = agentTracer();
  return tracer.startActiveSpan(
    `execute_tool ${attrs.toolName}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: toAttributes({
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.conversation.id': attrs.conversationId,
        'helm.tool.name': attrs.toolName,
      }),
    },
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Attach LLM usage numbers to the currently-active span. Called from the
 * agent loop after a `completeWithUsage` call resolves. Reads the active
 * span from OTel context — no span reference threading required.
 */
export function setLlmUsageAttributes(usage: {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  responseId?: string;
}): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  if (usage.model) span.setAttribute('gen_ai.request.model', usage.model);
  if (usage.inputTokens !== undefined)
    span.setAttribute('gen_ai.usage.input_tokens', usage.inputTokens);
  if (usage.outputTokens !== undefined)
    span.setAttribute('gen_ai.usage.output_tokens', usage.outputTokens);
  if (usage.responseId) span.setAttribute('gen_ai.response.id', usage.responseId);
}

/**
 * Attach HELM governance verdict to the currently-active span. Called from
 * the HELM client after each chat-completion call returns a receipt.
 */
export function setHelmAttributes(gov: {
  evidencePackId?: string;
  verdict?: string;
  policyVersion?: string;
  reasonCode?: string;
}): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  if (gov.evidencePackId) span.setAttribute('helm.evidence_pack.id', gov.evidencePackId);
  if (gov.verdict) span.setAttribute('helm.verdict', gov.verdict);
  if (gov.policyVersion) span.setAttribute('helm.policy.version', gov.policyVersion);
  if (gov.reasonCode) span.setAttribute('helm.reason_code', gov.reasonCode);
}

/**
 * Filter undefined values out of an attributes object so OTel doesn't
 * drop the whole attribute set on the floor.
 */
function toAttributes(obj: Record<string, string | number | undefined>): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
