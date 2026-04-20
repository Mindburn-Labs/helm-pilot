// ─── HubSpot Connector (Phase 15 Track I) ───
//
// Bearer Private App access token. CRM v3 API only — Marketing,
// Conversations, etc. are out of scope for this v1.

const HUBSPOT_API = 'https://api.hubapi.com/crm/v3';

export interface HubSpotContact {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface HubSpotDeal {
  id: string;
  name?: string;
  amount?: string;
  stage?: string;
  closeDate?: string;
  createdAt?: string;
}

export class HubSpotError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'HubSpotError';
  }
}

export class HubSpotConnector {
  constructor(private readonly token: string) {
    if (!token) throw new HubSpotError('HubSpot token is required');
  }

  async listContacts(opts?: { limit?: number }): Promise<HubSpotContact[]> {
    const limit = clamp(opts?.limit, 100, 25);
    const json = await this.call(
      `objects/contacts?limit=${limit}&properties=email,firstname,lastname,company`,
    );
    const results = Array.isArray(json['results'])
      ? (json['results'] as Record<string, unknown>[])
      : [];
    return results.map(parseContact);
  }

  async createContact(input: {
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
  }): Promise<HubSpotContact> {
    const properties: Record<string, string> = { email: input.email };
    if (input.firstName) properties['firstname'] = input.firstName;
    if (input.lastName) properties['lastname'] = input.lastName;
    if (input.company) properties['company'] = input.company;
    const json = await this.call('objects/contacts', {
      method: 'POST',
      body: { properties },
    });
    return parseContact(json);
  }

  async listDeals(opts?: { limit?: number }): Promise<HubSpotDeal[]> {
    const limit = clamp(opts?.limit, 100, 25);
    const json = await this.call(
      `objects/deals?limit=${limit}&properties=dealname,amount,dealstage,closedate`,
    );
    const results = Array.isArray(json['results'])
      ? (json['results'] as Record<string, unknown>[])
      : [];
    return results.map(parseDeal);
  }

  private async call(
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown } = {},
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${HUBSPOT_API}/${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!response.ok) {
      throw new HubSpotError(`HubSpot HTTP ${response.status}`, response.status);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}

function clamp(value: number | undefined, max: number, fallback: number): number {
  if (value == null) return fallback;
  return Math.max(1, Math.min(max, value));
}

function parseContact(raw: Record<string, unknown>): HubSpotContact {
  const props = (raw['properties'] as Record<string, unknown>) ?? {};
  return {
    id: String(raw['id'] ?? ''),
    email: props['email'] != null ? String(props['email']) : undefined,
    firstName: props['firstname'] != null ? String(props['firstname']) : undefined,
    lastName: props['lastname'] != null ? String(props['lastname']) : undefined,
    company: props['company'] != null ? String(props['company']) : undefined,
    createdAt: raw['createdAt'] != null ? String(raw['createdAt']) : undefined,
    updatedAt: raw['updatedAt'] != null ? String(raw['updatedAt']) : undefined,
  };
}

function parseDeal(raw: Record<string, unknown>): HubSpotDeal {
  const props = (raw['properties'] as Record<string, unknown>) ?? {};
  return {
    id: String(raw['id'] ?? ''),
    name: props['dealname'] != null ? String(props['dealname']) : undefined,
    amount: props['amount'] != null ? String(props['amount']) : undefined,
    stage: props['dealstage'] != null ? String(props['dealstage']) : undefined,
    closeDate: props['closedate'] != null ? String(props['closedate']) : undefined,
    createdAt: raw['createdAt'] != null ? String(raw['createdAt']) : undefined,
  };
}
