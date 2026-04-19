import {
  HelmDeniedError,
  HelmEscalationError,
  HelmNotImplementedError,
  HelmUnreachableError,
} from './errors.js';
import { parseReceiptHeaders } from './receipts.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  EvaluateRequest,
  EvaluateResult,
  HealthSnapshot,
  HelmClientConfig,
  HelmReceipt,
  Soc2BundleResult,
  MerkleRootResult,
  BudgetStatusResult,
  ObligationRequest,
  ObligationResult,
  BoundaryCheckResult,
  MemoryListResult,
  MemoryPromoteResult,
  ContextBundleListResult,
  EconomicChargesResult,
  EconomicAllocationsResult,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 100;

/**
 * Thin TypeScript client for helm-oss v0.3.0+.
 *
 * Fail-closed discipline:
 *   - 2xx with governance headers + verdict=ALLOW → return the response + receipt
 *   - 403 with governance headers + verdict=DENY   → throw HelmDeniedError
 *   - 403 with governance headers + verdict=ESCALATE → throw HelmEscalationError
 *   - any other condition (network, 5xx, parse error, missing headers) → treat
 *     as HELM_UNREACHABLE which callers MUST interpret as DENY.
 *
 * Retries apply ONLY to transient unreachability (5xx, timeout, network). A
 * definitive governance verdict (403 with headers) is never retried.
 */
export class HelmClient {
  private readonly cfg: Required<
    Omit<HelmClientConfig, 'healthUrl' | 'defaultPrincipal' | 'adminApiKey' | 'onReceipt' | 'fetchImpl'>
  > & Pick<HelmClientConfig, 'healthUrl' | 'defaultPrincipal' | 'adminApiKey' | 'onReceipt' | 'fetchImpl'>;

  constructor(cfg: HelmClientConfig) {
    if (!cfg.baseUrl) throw new Error('HelmClient: baseUrl is required');
    this.cfg = {
      baseUrl: stripTrailingSlash(cfg.baseUrl),
      healthUrl: cfg.healthUrl ? stripTrailingSlash(cfg.healthUrl) : undefined,
      defaultPrincipal: cfg.defaultPrincipal,
      adminApiKey: cfg.adminApiKey,
      timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: cfg.maxRetries ?? DEFAULT_MAX_RETRIES,
      baseBackoffMs: cfg.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS,
      failClosed: cfg.failClosed ?? true,
      evaluateEnabled: cfg.evaluateEnabled ?? false,
      onReceipt: cfg.onReceipt,
      fetchImpl: cfg.fetchImpl ?? globalThis.fetch,
    };
  }

  /**
   * Request a HELM-governed chat completion. Pilot's LLM provider should
   * funnel every inference call through here so Guardian can enforce policy
   * and attach signed receipts.
   */
  async chatCompletion(
    principal: string | undefined,
    body: ChatCompletionRequest,
  ): Promise<ChatCompletionResult> {
    const effectivePrincipal = principal ?? this.cfg.defaultPrincipal ?? 'anonymous';
    const url = `${this.cfg.baseUrl}/v1/chat/completions`;

    const response = await this.governedFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Helm-Principal': effectivePrincipal,
        ...(this.cfg.adminApiKey ? { Authorization: `Bearer ${this.cfg.adminApiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    const ctx = { action: 'LLM_INFERENCE', resource: body.model, principal: effectivePrincipal };
    const receipt = parseReceiptHeaders(response.headers, ctx);

    if (response.status === 403) {
      await this.handleForbidden(response, receipt);
      // handleForbidden always throws — this is unreachable
      throw new Error('unreachable');
    }

    if (!response.ok) {
      // 5xx or unexpected: caller treats as unreachable/fail-closed
      throw new HelmUnreachableError(
        `HELM returned HTTP ${response.status} for chatCompletion`,
        await safeReadText(response),
      );
    }

    if (!receipt) {
      // 200 with missing governance headers is a protocol violation — fail closed
      throw new HelmUnreachableError(
        'HELM response missing governance receipt headers on a 2xx chatCompletion',
      );
    }

    await this.emitReceipt(receipt);

    const parsed = (await response.json()) as ChatCompletionResult['body'];
    return { body: parsed, receipt };
  }

  /**
   * Check whether HELM is up. Not governed — safe to call from health probes
   * and circuit-breakers.
   */
  async health(): Promise<HealthSnapshot> {
    const started = Date.now();
    const target = this.cfg.healthUrl ?? this.cfg.baseUrl;
    try {
      const response = await this.rawFetch(`${target}/healthz`, { method: 'GET' });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        return {
          gatewayOk: false,
          latencyMs,
          checkedAt: new Date(),
          error: `HTTP ${response.status}`,
        };
      }
      const text = await safeReadText(response);
      const version = extractVersionFromHealth(text) ?? undefined;
      return { gatewayOk: true, latencyMs, checkedAt: new Date(), version };
    } catch (err) {
      return {
        gatewayOk: false,
        latencyMs: Date.now() - started,
        checkedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Generic governance evaluation — reserved for the upstream `POST
   * /api/v1/guardian/evaluate` endpoint that helm-oss does not yet expose.
   *
   * Until that endpoint ships, tool-call governance is performed by the local
   * Pilot TrustBoundary while LLM calls are already governed via
   * {@link chatCompletion}.
   */
  async evaluate(req: EvaluateRequest): Promise<EvaluateResult> {
    // Phase 13.5 — real implementation. Gated on this.cfg.evaluateEnabled
    // (or env HELM_EVALUATE_ENABLED=1) so builds against helm-oss v0.3.0
    // (no endpoint) still fail closed. Flip to true once the upstream
    // POST /api/v1/guardian/evaluate handler lands in v0.3.1.
    const enabled =
      this.cfg.evaluateEnabled === true ||
      (typeof process !== 'undefined' &&
        process.env?.['HELM_EVALUATE_ENABLED'] === '1');
    if (!enabled) {
      throw new HelmNotImplementedError(
        'Generic HELM evaluate() is disabled. Set HELM_EVALUATE_ENABLED=1 ' +
          '(or HelmClientConfig.evaluateEnabled=true) once the upstream ' +
          'POST /api/v1/guardian/evaluate endpoint is available.',
      );
    }

    const principal = req.principal || this.cfg.defaultPrincipal || 'anonymous';
    const url = `${this.cfg.baseUrl}/api/v1/guardian/evaluate`;
    const response = await this.governedFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Helm-Principal': principal,
        ...(this.cfg.adminApiKey
          ? { Authorization: `Bearer ${this.cfg.adminApiKey}` }
          : {}),
      },
      body: JSON.stringify({
        principal,
        action: req.action,
        resource: req.resource,
        context: req.context ?? {},
      }),
    });

    const ctx = {
      action: req.action,
      resource: req.resource,
      principal,
    };
    const receipt = parseReceiptHeaders(response.headers, ctx);

    if (response.status === 403) {
      await this.handleForbidden(response, receipt);
      throw new Error('unreachable');
    }

    if (!response.ok) {
      throw new HelmUnreachableError(
        `HELM returned HTTP ${response.status} for evaluate`,
        await safeReadText(response),
      );
    }

    if (!receipt) {
      throw new HelmUnreachableError(
        'HELM response missing governance receipt headers on a 2xx evaluate',
      );
    }

    await this.emitReceipt(receipt);

    const evidencePackId =
      response.headers.get('x-helm-evidence-pack-id') ?? undefined;
    return { receipt, evidencePackId };
  }

  // ─── Phase 14 Track F — helm-oss endpoint integration ───
  //
  // Thin wrappers around helm-oss HTTP endpoints. All use governedFetch
  // for retries + failClosed semantics + 403 handling. No receipt
  // emission on these (they're read-only inspection endpoints), except
  // createObligation which does write helm-oss-side state.

  /** Export a SOC2 compliance bundle for a workspace. */
  async exportSoc2(workspaceId: string): Promise<Soc2BundleResult> {
    const url = `${this.cfg.baseUrl}/api/v1/evidence/soc2?workspaceId=${encodeURIComponent(workspaceId)}`;
    const response = await this.governedFetch(url, { method: 'GET', headers: this.adminHeaders() });
    return (await response.json()) as Soc2BundleResult;
  }

  /** Retrieve the current Merkle tree root of the proof-graph. */
  async getMerkleRoot(): Promise<MerkleRootResult> {
    const url = `${this.cfg.baseUrl}/api/v1/merkle/root`;
    const response = await this.governedFetch(url, { method: 'GET', headers: this.adminHeaders() });
    return (await response.json()) as MerkleRootResult;
  }

  /** Current spend, daily/monthly limits, alerts. */
  async getBudgetStatus(): Promise<BudgetStatusResult> {
    const url = `${this.cfg.baseUrl}/api/v1/budget/status`;
    const response = await this.governedFetch(url, { method: 'GET', headers: this.adminHeaders() });
    return (await response.json()) as BudgetStatusResult;
  }

  /** Register a post-decision obligation (e.g. retain PHI access log for 2190 days). */
  async createObligation(req: ObligationRequest): Promise<ObligationResult> {
    const url = `${this.cfg.baseUrl}/api/v1/obligation/create`;
    const response = await this.governedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify(req),
    });
    return (await response.json()) as ObligationResult;
  }

  /** Sandbox / boundary violation status check. */
  async boundaryCheck(): Promise<BoundaryCheckResult> {
    const url = `${this.cfg.baseUrl}/api/v1/boundary/check`;
    const response = await this.governedFetch(url, { method: 'GET', headers: this.adminHeaders() });
    return (await response.json()) as BoundaryCheckResult;
  }

  /** List shared memory entries accessible to a workspace. */
  async listMemory(workspaceId: string, cursor?: string): Promise<MemoryListResult> {
    const qs = new URLSearchParams({ workspaceId });
    if (cursor) qs.set('cursor', cursor);
    const url = `${this.cfg.baseUrl}/api/v1/memory/list?${qs.toString()}`;
    const response = await this.governedFetch(url, { method: 'GET', headers: this.adminHeaders() });
    return (await response.json()) as MemoryListResult;
  }

  /** Promote a workspace-scoped page into shared HELM memory. */
  async promoteMemory(workspaceId: string, pageId: string): Promise<MemoryPromoteResult> {
    const url = `${this.cfg.baseUrl}/api/v1/memory/promote`;
    const response = await this.governedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify({ workspaceId, pageId }),
    });
    return (await response.json()) as MemoryPromoteResult;
  }

  /** Reusable context snapshots available to the workspace. */
  async getContextBundles(workspaceId: string): Promise<ContextBundleListResult> {
    const url = `${this.cfg.baseUrl}/api/v1/context/bundles?workspaceId=${encodeURIComponent(workspaceId)}`;
    const response = await this.governedFetch(url, { method: 'GET', headers: this.adminHeaders() });
    return (await response.json()) as ContextBundleListResult;
  }

  /** Per-workspace USD charges in a time window. */
  async getEconomicCharges(
    workspaceId: string,
    from: string,
    to: string,
  ): Promise<EconomicChargesResult> {
    const qs = new URLSearchParams({ workspaceId, from, to });
    const url = `${this.cfg.baseUrl}/api/v1/economic/charges?${qs.toString()}`;
    const response = await this.governedFetch(url, { method: 'GET', headers: this.adminHeaders() });
    return (await response.json()) as EconomicChargesResult;
  }

  /** Per-workspace budget allocations + consumption. */
  async getEconomicAllocations(workspaceId: string): Promise<EconomicAllocationsResult> {
    const url = `${this.cfg.baseUrl}/api/v1/economic/allocations?workspaceId=${encodeURIComponent(workspaceId)}`;
    const response = await this.governedFetch(url, { method: 'GET', headers: this.adminHeaders() });
    return (await response.json()) as EconomicAllocationsResult;
  }

  private adminHeaders(): Record<string, string> {
    return this.cfg.adminApiKey
      ? { Authorization: `Bearer ${this.cfg.adminApiKey}` }
      : {};
  }

  // ─── internals ───

  private async governedFetch(url: string, init: RequestInit): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.cfg.maxRetries; attempt++) {
      try {
        const response = await this.rawFetch(url, init);
        // 403 is a definitive verdict, do not retry
        if (response.status === 403) return response;
        // 2xx succeeds, return
        if (response.ok) return response;
        // 5xx / unexpected — retry
        lastErr = new HelmUnreachableError(
          `HELM HTTP ${response.status}`,
          await safeReadText(response),
          attempt,
        );
      } catch (err) {
        lastErr = err instanceof HelmUnreachableError
          ? err
          : new HelmUnreachableError(
              err instanceof Error ? err.message : String(err),
              err,
              attempt,
            );
      }
      if (attempt < this.cfg.maxRetries) {
        await sleep(this.backoffFor(attempt));
      }
    }
    throw lastErr instanceof HelmUnreachableError
      ? lastErr
      : new HelmUnreachableError('HELM unreachable after retries', lastErr);
  }

  private async rawFetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      return await this.cfg.fetchImpl!(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private backoffFor(attempt: number): number {
    // Exponential backoff with ±25% jitter.
    const base = this.cfg.baseBackoffMs * Math.pow(4, attempt - 1);
    const jitter = base * 0.25;
    return Math.round(base + (Math.random() * 2 - 1) * jitter);
  }

  private async handleForbidden(
    response: Response,
    receipt: HelmReceipt | null,
  ): Promise<never> {
    const reason = await readReason(response);
    if (!receipt) {
      throw new HelmUnreachableError(
        'HELM returned 403 without governance receipt headers (protocol violation)',
      );
    }
    const enriched: HelmReceipt = { ...receipt, reason };
    await this.emitReceipt(enriched);
    if (enriched.verdict === 'ESCALATE') throw new HelmEscalationError(enriched, reason);
    throw new HelmDeniedError(enriched, reason);
  }

  private async emitReceipt(receipt: HelmReceipt): Promise<void> {
    if (!this.cfg.onReceipt) return;
    try {
      await this.cfg.onReceipt(receipt);
    } catch {
      // Receipt persistence failure must not break the governed call.
    }
  }
}

// ─── helpers ───

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

async function readReason(response: Response): Promise<string> {
  const text = await safeReadText(response);
  if (!text) return 'governance denied (no body)';
  try {
    const parsed = JSON.parse(text) as { message?: string; reason?: string; error?: string };
    return parsed.reason ?? parsed.message ?? parsed.error ?? text.slice(0, 500);
  } catch {
    return text.slice(0, 500);
  }
}

function extractVersionFromHealth(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
