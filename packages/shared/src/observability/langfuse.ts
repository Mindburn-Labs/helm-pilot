// ─── Langfuse shim (Phase 14 Track D) ───
//
// Optional trace exporter. Activates only when all three env vars are set:
//   LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST
//
// When unset, every function here is a no-op — zero runtime cost,
// zero dependency load. When set, we dynamic-import the `langfuse`
// package (optional peer dep; operators who want Langfuse install
// `langfuse` in their deployment image).
//
// We ship this as a shadow of the OTel GenAI spans we already emit —
// so operators get *two* tracing surfaces when they set both
// OTEL_EXPORTER_OTLP_ENDPOINT and LANGFUSE_*. No double-billing:
// OTel targets local Jaeger/Tempo; Langfuse is cloud-hosted + adds
// LLM-specific prompt / output / score / user-id indexing.
//
// Reference: https://langfuse.com/docs/sdk/typescript/guide

let client: LangfuseLike | null = null;
let tried = false;

interface LangfuseTraceOptions {
  name: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

interface LangfuseGenerationOptions {
  name: string;
  model?: string;
  input?: unknown;
  output?: unknown;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
    cacheReadInputUnits?: number;
    cacheCreationInputUnits?: number;
  };
  metadata?: Record<string, unknown>;
}

interface LangfuseTraceHandle {
  generation(opts: LangfuseGenerationOptions): void;
  update(opts: Partial<LangfuseTraceOptions>): void;
}

interface LangfuseLike {
  trace(opts: LangfuseTraceOptions): LangfuseTraceHandle;
  flushAsync(): Promise<void>;
  shutdownAsync?(): Promise<void>;
}

async function getClient(): Promise<LangfuseLike | null> {
  if (client || tried) return client;
  tried = true;

  const publicKey = process.env['LANGFUSE_PUBLIC_KEY'];
  const secretKey = process.env['LANGFUSE_SECRET_KEY'];
  const baseUrl = process.env['LANGFUSE_HOST'];
  if (!publicKey || !secretKey || !baseUrl) return null;

  try {
    // Dynamic import keeps `langfuse` a true optional peer dep.
    const mod = (await import('langfuse' as string).catch(() => null)) as
      | { Langfuse?: new (args: unknown) => LangfuseLike }
      | null;
    const Ctor = mod?.Langfuse;
    if (!Ctor) return null;
    client = new Ctor({ publicKey, secretKey, baseUrl });
    return client;
  } catch {
    return null;
  }
}

/**
 * Record an agent-loop iteration (one planning LLM call + action).
 * Fires-and-forgets; never throws. Pass the same `taskId` for all
 * iterations of a task so they group in the Langfuse UI.
 */
export async function recordLangfuseGeneration(params: {
  workspaceId: string;
  taskId: string;
  name: string;
  model?: string;
  input?: unknown;
  output?: unknown;
  usage?: {
    tokensIn?: number;
    tokensOut?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const c = await getClient();
  if (!c) return;
  try {
    const trace = c.trace({
      name: params.name,
      userId: params.workspaceId,
      sessionId: params.taskId,
    });
    trace.generation({
      name: params.name,
      model: params.model,
      input: params.input,
      output: params.output,
      usage: params.usage
        ? {
            input: params.usage.tokensIn,
            output: params.usage.tokensOut,
            cacheReadInputUnits: params.usage.cacheReadTokens,
            cacheCreationInputUnits: params.usage.cacheCreationTokens,
          }
        : undefined,
      metadata: params.metadata,
    });
  } catch {
    /* exporter errors are never fatal */
  }
}

/**
 * Flush pending Langfuse events. Call on graceful shutdown so the last
 * few traces don't get lost when the container stops.
 */
export async function flushLangfuse(): Promise<void> {
  const c = await getClient();
  if (!c) return;
  try {
    await c.flushAsync();
  } catch {
    /* ignore */
  }
}
