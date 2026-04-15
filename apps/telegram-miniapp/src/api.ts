const BASE = '/api';

let authToken: string | null = null;

export function setAuthToken(token: string) {
  authToken = token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...init, headers });

  // Handle session rotation
  const newToken = res.headers.get('X-New-Token');
  if (newToken) {
    authToken = newToken;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Auth ───

export interface AuthResponse {
  token: string;
  user: { id: string; name: string; telegramId: string };
  workspace: { id: string; name: string };
  expiresAt: string;
}

export function authenticate(initData: string): Promise<AuthResponse> {
  return request('/auth/telegram', {
    method: 'POST',
    body: JSON.stringify({ initData }),
  });
}

// ─── Status ───

export interface StatusResponse {
  workspace: { id: string; name: string; currentMode: string };
  tasks: { total: number; running: number; queued: number; completed: number; failed: number; awaitingApproval: number };
  operators: number;
  pendingApprovals: number;
}

export function getStatus(workspaceId: string): Promise<StatusResponse> {
  return request(`/status?workspaceId=${workspaceId}`);
}

// ─── Tasks ───

export interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  mode: string;
  operatorId: string | null;
  createdAt: string;
}

export function getTasks(workspaceId: string): Promise<Task[]> {
  return request(`/tasks?workspaceId=${workspaceId}`);
}

export function createTask(body: {
  workspaceId: string;
  title: string;
  description: string;
  mode: string;
  autoRun?: boolean;
  operatorId?: string;
}): Promise<Task> {
  return request('/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ─── Operators ───

export interface Operator {
  id: string;
  name: string;
  role: string;
  goal: string;
  isActive: boolean;
}

export interface OperatorRole {
  id: string;
  name: string;
  description: string;
}

export function getOperators(workspaceId: string): Promise<Operator[]> {
  return request(`/operators?workspaceId=${workspaceId}`);
}

export function getOperatorRoles(): Promise<OperatorRole[]> {
  return request('/operators/roles');
}

export function createOperator(body: {
  workspaceId: string;
  name: string;
  role: string;
  goal: string;
}): Promise<Operator> {
  return request('/operators', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ─── Opportunities ───

export interface Opportunity {
  id: string;
  title: string;
  description: string;
  source: string;
  sourceUrl: string | null;
  discoveredAt: string;
}

export function getOpportunities(workspaceId: string): Promise<Opportunity[]> {
  return request(`/opportunities?workspaceId=${workspaceId}`);
}

export function createOpportunity(body: {
  workspaceId?: string;
  source: string;
  title: string;
  description: string;
  sourceUrl?: string;
}): Promise<Opportunity> {
  return request('/opportunities', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ─── Knowledge ───

export interface KnowledgeResult {
  id: string;
  title: string;
  type: string;
  score: number;
}

export function searchKnowledge(query: string, limit = 20): Promise<KnowledgeResult[]> {
  return request(`/knowledge/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}

export function createKnowledgePage(body: {
  type: string;
  title: string;
  content?: string;
}): Promise<{ id: string }> {
  return request('/knowledge/pages', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ─── Applications ───

export interface Application {
  id: string;
  targetProgram: string;
  status: string;
  submittedAt: string | null;
  createdAt: string;
}

export function getApplications(workspaceId: string): Promise<Application[]> {
  return request(`/applications?workspaceId=${workspaceId}`);
}

export function createApplication(workspaceId: string, targetProgram: string): Promise<Application> {
  return request('/applications', {
    method: 'POST',
    body: JSON.stringify({ workspaceId, targetProgram }),
  });
}

export function updateApplicationStatus(id: string, status: string): Promise<Application> {
  return request(`/applications/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

// ─── Approvals ───

export interface Approval {
  id: string;
  action: string;
  reason: string;
  status: string;
  taskId: string | null;
  requestedAt: string;
}

export function getApprovals(workspaceId: string, status = 'pending'): Promise<Approval[]> {
  return request(`/audit/approvals?workspaceId=${workspaceId}&status=${status}`);
}

export function resolveApproval(id: string, status: 'approved' | 'rejected'): Promise<Approval> {
  return request(`/audit/approvals/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

// ─── Workspace ───

export function switchMode(workspaceId: string, mode: string): Promise<{ id: string; currentMode: string }> {
  return request(`/workspace/${workspaceId}/mode`, {
    method: 'PUT',
    body: JSON.stringify({ mode }),
  });
}

export interface WorkspaceSettings {
  policyConfig: Record<string, unknown>;
  budgetConfig: Record<string, unknown>;
  modelConfig: Record<string, unknown>;
}

export function getSettings(workspaceId: string): Promise<WorkspaceSettings> {
  return request(`/workspace/${workspaceId}/settings`);
}

export function updateSettings(workspaceId: string, settings: Partial<WorkspaceSettings>): Promise<WorkspaceSettings> {
  return request(`/workspace/${workspaceId}/settings`, {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

// ─── Founder Profile ───

export interface FounderProfile {
  id: string;
  name: string;
  background: string | null;
  experience: string | null;
  interests: string[];
}

export function getProfile(workspaceId: string): Promise<FounderProfile | null> {
  return request<FounderProfile>(`/founder/${workspaceId}`).catch(() => null);
}

// ─── Connectors ───

export interface ConnectorDef {
  id: string;
  name: string;
  description: string;
}

export function getConnectors(): Promise<ConnectorDef[]> {
  return request('/connectors');
}

export function getConnectorGrants(workspaceId: string): Promise<{ connectorId: string; isActive: boolean }[]> {
  return request(`/connectors/grants?workspaceId=${workspaceId}`);
}
