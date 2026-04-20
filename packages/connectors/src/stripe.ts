// ─── Stripe Connector (Phase 15 Track I) ───
//
// Read-only by default. Bearer secret-key auth (sk_live_… / sk_test_…).
// All money-moving endpoints (Refunds, PaymentIntents create) are
// deliberately excluded from this v1 — Pilot subagents can observe
// revenue, not move it. Mutating endpoints land in a follow-up commit
// behind an explicit `mutating:true` env opt-in.

const STRIPE_API = 'https://api.stripe.com/v1';

export interface StripeCustomer {
  id: string;
  email?: string;
  name?: string;
  createdAt: string;
}

export interface StripeCharge {
  id: string;
  /** Minor units (cents). */
  amount: number;
  currency: string;
  status: string;
  description?: string;
  createdAt: string;
}

export interface StripeBalanceLine {
  amount: number;
  currency: string;
}

export interface StripeBalance {
  available: StripeBalanceLine[];
  pending: StripeBalanceLine[];
}

export class StripeError extends Error {
  constructor(message: string, readonly stripeCode?: string) {
    super(message);
    this.name = 'StripeError';
  }
}

export class StripeConnector {
  constructor(private readonly secretKey: string) {
    if (!secretKey) throw new StripeError('Stripe secret key is required');
  }

  async listCustomers(opts?: { limit?: number }): Promise<StripeCustomer[]> {
    const limit = clampLimit(opts?.limit, 100, 10);
    const json = await this.call(`customers?limit=${limit}`);
    const data = Array.isArray(json['data']) ? (json['data'] as Record<string, unknown>[]) : [];
    return data.map((c) => ({
      id: String(c['id']),
      email: c['email'] != null ? String(c['email']) : undefined,
      name: c['name'] != null ? String(c['name']) : undefined,
      createdAt: epochToIso(c['created']),
    }));
  }

  async recentCharges(opts?: { limit?: number }): Promise<StripeCharge[]> {
    const limit = clampLimit(opts?.limit, 100, 10);
    const json = await this.call(`charges?limit=${limit}`);
    const data = Array.isArray(json['data']) ? (json['data'] as Record<string, unknown>[]) : [];
    return data.map((c) => ({
      id: String(c['id']),
      amount: Number(c['amount'] ?? 0),
      currency: String(c['currency'] ?? 'usd'),
      status: String(c['status'] ?? 'unknown'),
      description: c['description'] != null ? String(c['description']) : undefined,
      createdAt: epochToIso(c['created']),
    }));
  }

  async balance(): Promise<StripeBalance> {
    const json = await this.call('balance');
    return {
      available: parseLines(json['available']),
      pending: parseLines(json['pending']),
    };
  }

  private async call(path: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${STRIPE_API}/${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Stripe-Version': '2024-10-28.acacia',
      },
    });
    if (!response.ok) {
      let code: string | undefined;
      try {
        const errBody = (await response.json()) as Record<string, unknown>;
        const errObj = errBody['error'] as Record<string, unknown> | undefined;
        code = errObj && typeof errObj['code'] === 'string' ? errObj['code'] : undefined;
      } catch {
        /* ignore */
      }
      throw new StripeError(`Stripe HTTP ${response.status}`, code);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}

function clampLimit(value: number | undefined, max: number, fallback: number): number {
  if (value == null) return fallback;
  return Math.max(1, Math.min(max, value));
}

function epochToIso(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  return '';
}

function parseLines(input: unknown): StripeBalanceLine[] {
  if (!Array.isArray(input)) return [];
  return (input as Record<string, unknown>[]).map((l) => ({
    amount: Number(l['amount'] ?? 0),
    currency: String(l['currency'] ?? 'usd'),
  }));
}
