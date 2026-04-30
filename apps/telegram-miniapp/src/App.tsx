import { useState, useEffect, useCallback } from 'react';
import {
  authenticate,
  setAuthToken,
  getStatus,
  getTasks,
  createTask,
  getOperators,
  createOperator,
  getOperatorRoles,
  getOpportunities,
  createOpportunity,
  searchKnowledge,
  createKnowledgePage,
  getApplications,
  createApplication,
  updateApplicationStatus,
  getApprovals,
  resolveApproval,
  switchMode,
  getProfile,
  getSettings,
  updateSettings,
  getReauthStatus,
  getManagedTelegramState,
  createManagedTelegramProvisioning,
  updateManagedTelegramSettings,
} from './api.js';
import { useAsync } from './hooks.js';
import {
  detectTelegramCapabilities,
  getDeviceStorageItem,
  requestCommandCenterFullscreen,
  requestHomeScreenShortcut,
  setDeviceStorageItem,
  setSecureStorageItem,
  type TelegramWebAppBridge,
} from './telegram-capabilities.js';
import type {
  AuthResponse,
  OperatorRole,
  KnowledgeResult,
  ReauthGrant,
  ManagedTelegramState,
} from './api.js';

const MODES = ['discover', 'decide', 'build', 'launch', 'apply'] as const;
const TABS = ['home', 'discover', 'build', 'knowledge', 'apps', 'settings'] as const;
type Tab = (typeof TABS)[number];

const TAB_ICONS: Record<Tab, string> = {
  home: '\u2302', // house
  discover: '\u2609', // compass
  build: '\u2692', // hammer
  knowledge: '\u2261', // book
  apps: '\u2750', // document
  settings: '\u2699', // gear
};

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: { user?: { first_name?: string; id?: number } };
        ready: () => void;
        expand: () => void;
        close: () => void;
        themeParams: Record<string, string>;
        colorScheme: 'light' | 'dark';
        HapticFeedback: {
          impactOccurred: (style: string) => void;
          notificationOccurred: (type: string) => void;
        };
        MainButton: {
          text: string;
          show: () => void;
          hide: () => void;
          onClick: (cb: () => void) => void;
          offClick: (cb: () => void) => void;
        };
      } & TelegramWebAppBridge;
    };
  }
}

function haptic(type: 'light' | 'medium' | 'success' | 'error' = 'light') {
  try {
    if (type === 'success' || type === 'error') {
      window.Telegram?.WebApp.HapticFeedback.notificationOccurred(type);
    } else {
      window.Telegram?.WebApp.HapticFeedback.impactOccurred(type);
    }
  } catch {
    /* not in Telegram */
  }
}

// ─── App Root ───

export function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [telegramCapabilities, setTelegramCapabilities] = useState(() =>
    detectTelegramCapabilities(window.Telegram?.WebApp),
  );

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) {
      setAuthError('Not running inside Telegram');
      return;
    }
    tg.ready();
    tg.expand();
    setTelegramCapabilities(detectTelegramCapabilities(tg));
    void getDeviceStorageItem(tg, 'helm_pilot_active_tab').then((tab) => {
      if (tab && (TABS as readonly string[]).includes(tab)) {
        setActiveTab(tab as Tab);
      }
    });
    if (!tg.initData) {
      setAuthError('No init data from Telegram');
      return;
    }
    authenticate(tg.initData)
      .then((res) => {
        setAuthToken(res.token);
        setAuth(res);
        void setSecureStorageItem(
          tg,
          'helm_pilot_session_hint',
          JSON.stringify({
            workspaceId: res.workspace.id,
            userId: res.user.id,
            storedAt: new Date().toISOString(),
          }),
        );
      })
      .catch((e: Error) => setAuthError(e.message));
  }, []);

  const switchTab = useCallback((tab: Tab) => {
    haptic('light');
    setActiveTab(tab);
    void setDeviceStorageItem(window.Telegram?.WebApp, 'helm_pilot_active_tab', tab);
  }, []);

  if (authError)
    return (
      <div>
        <div className="header">
          <h1>HELM Pilot</h1>
        </div>
        <div className="error-banner">{authError}</div>
      </div>
    );

  if (!auth) return <div className="loading">Connecting...</div>;

  const wsId = auth.workspace.id;

  return (
    <div className="app-shell">
      <div className="header">
        <h1>
          HELM Pilot <span className="mode-badge">v0.1</span>
        </h1>
        <div className="subtitle">
          Hey, {auth.user.name} &middot; {auth.workspace.name}
        </div>
      </div>

      <ReauthBanner workspaceId={wsId} />

      <div className="tab-content">
        {activeTab === 'home' && (
          <HomeTab
            workspaceId={wsId}
            onNavigate={switchTab}
            telegramCapabilities={telegramCapabilities}
          />
        )}
        {activeTab === 'discover' && <DiscoverTab workspaceId={wsId} />}
        {activeTab === 'build' && <BuildTab workspaceId={wsId} />}
        {activeTab === 'knowledge' && <KnowledgeTab />}
        {activeTab === 'apps' && <AppsTab workspaceId={wsId} />}
        {activeTab === 'settings' && <SettingsTab workspaceId={wsId} />}
      </div>

      <nav className="bottom-nav">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`nav-item ${activeTab === tab ? 'active' : ''}`}
            onClick={() => switchTab(tab)}
          >
            <span className="nav-icon">{TAB_ICONS[tab]}</span>
            <span className="nav-label">{tab.charAt(0).toUpperCase() + tab.slice(1)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── Home Tab ───

function HomeTab({
  workspaceId,
  onNavigate,
  telegramCapabilities,
}: {
  workspaceId: string;
  onNavigate: (t: Tab) => void;
  telegramCapabilities: ReturnType<typeof detectTelegramCapabilities>;
}) {
  const { data: status, loading, reload } = useAsync(() => getStatus(workspaceId), [workspaceId]);
  const { data: approvals } = useAsync(() => getApprovals(workspaceId), [workspaceId]);

  const handleModeSwitch = async (mode: string) => {
    haptic('medium');
    await switchMode(workspaceId, mode);
    reload();
  };

  const handleApproval = async (id: string, verdict: 'approved' | 'rejected') => {
    haptic(verdict === 'approved' ? 'success' : 'error');
    await resolveApproval(id, verdict);
    reload();
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <>
      <div className="section">
        <div className="section-header">Dashboard</div>
        <div className="stat-grid">
          <StatCard
            value={status?.tasks.running ?? 0}
            label="Running"
            onClick={() => onNavigate('build')}
          />
          <StatCard value={status?.tasks.queued ?? 0} label="Queued" />
          <StatCard value={status?.tasks.completed ?? 0} label="Done" />
          <StatCard value={status?.pendingApprovals ?? 0} label="Approvals" accent />
        </div>
      </div>

      {(telegramCapabilities.fullscreen || telegramCapabilities.homeScreen) && (
        <div className="section">
          <div className="section-header">Command Center</div>
          <div className="pill-row">
            {telegramCapabilities.fullscreen && (
              <button
                className="pill"
                onClick={() => {
                  haptic('medium');
                  requestCommandCenterFullscreen(window.Telegram?.WebApp);
                }}
              >
                Fullscreen
              </button>
            )}
            {telegramCapabilities.homeScreen && (
              <button
                className="pill"
                onClick={() => {
                  haptic('success');
                  requestHomeScreenShortcut(window.Telegram?.WebApp);
                }}
              >
                Home screen
              </button>
            )}
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-header">
          Mode &middot; {status?.workspace.currentMode ?? 'discover'}
        </div>
        <div className="pill-row">
          {MODES.map((m) => (
            <button
              key={m}
              className={`pill ${status?.workspace.currentMode === m ? 'active' : ''}`}
              onClick={() => handleModeSwitch(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {approvals && approvals.length > 0 && (
        <div className="section">
          <div className="section-header">Pending Approvals ({approvals.length})</div>
          {approvals.map((a) => (
            <div key={a.id} className="approval-card">
              <div className="approval-action">{a.action}</div>
              <div className="approval-reason">{a.reason}</div>
              <div className="approval-buttons">
                <button
                  className="btn btn-approve"
                  onClick={() => handleApproval(a.id, 'approved')}
                >
                  Approve
                </button>
                <button className="btn btn-reject" onClick={() => handleApproval(a.id, 'rejected')}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function StatCard({
  value,
  label,
  accent,
  onClick,
}: {
  value: number;
  label: string;
  accent?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={`stat-card ${accent && value > 0 ? 'accent' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// ─── Discover Tab ───

function DiscoverTab({ workspaceId }: { workspaceId: string }) {
  const {
    data: opps,
    loading,
    reload,
  } = useAsync(() => getOpportunities(workspaceId), [workspaceId]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [source, setSource] = useState('manual');

  const handleCreate = async () => {
    if (!title.trim()) return;
    haptic('success');
    await createOpportunity({ workspaceId, source, title: title.trim(), description: desc.trim() });
    setTitle('');
    setDesc('');
    setShowForm(false);
    reload();
  };

  if (loading) return <div className="loading">Loading opportunities...</div>;

  return (
    <>
      <div className="section">
        <div className="section-header-row">
          <span className="section-header">Opportunities ({opps?.length ?? 0})</span>
          <button
            className="btn-icon"
            onClick={() => {
              haptic('light');
              setShowForm(!showForm);
            }}
          >
            +
          </button>
        </div>

        {showForm && (
          <div className="form-card">
            <div className="pill-row" style={{ marginBottom: 8 }}>
              {['manual', 'yc', 'market'].map((s) => (
                <button
                  key={s}
                  className={`pill ${source === s ? 'active' : ''}`}
                  onClick={() => setSource(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <input
              className="input"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="input textarea"
              placeholder="Description"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
            <button className="btn btn-primary" onClick={handleCreate}>
              Create
            </button>
          </div>
        )}

        {opps?.length === 0 && !showForm && (
          <div className="empty-state">No opportunities yet. Tap + to add one.</div>
        )}

        <ul className="item-list">
          {opps?.map((o) => (
            <li key={o.id} className="item-row">
              <div className="item-title">{o.title}</div>
              <div className="item-meta">
                {o.source} &middot; {new Date(o.discoveredAt).toLocaleDateString()}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// ─── Build Tab ───

function BuildTab({ workspaceId }: { workspaceId: string }) {
  const { data: tasks, loading, reload } = useAsync(() => getTasks(workspaceId), [workspaceId]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [mode, setMode] = useState<string>('build');
  const [autoRun, setAutoRun] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) return;
    haptic('success');
    await createTask({ workspaceId, title: title.trim(), description: desc.trim(), mode, autoRun });
    setTitle('');
    setDesc('');
    setShowForm(false);
    reload();
  };

  if (loading) return <div className="loading">Loading tasks...</div>;

  return (
    <>
      <div className="section">
        <div className="section-header-row">
          <span className="section-header">Tasks ({tasks?.length ?? 0})</span>
          <button
            className="btn-icon"
            onClick={() => {
              haptic('light');
              setShowForm(!showForm);
            }}
          >
            +
          </button>
        </div>

        {showForm && (
          <div className="form-card">
            <input
              className="input"
              placeholder="Task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="input textarea"
              placeholder="Description (optional)"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
            <div className="pill-row" style={{ marginBottom: 8 }}>
              {MODES.map((m) => (
                <button
                  key={m}
                  className={`pill ${mode === m ? 'active' : ''}`}
                  onClick={() => setMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={autoRun}
                onChange={(e) => setAutoRun(e.target.checked)}
              />
              <span>Auto-run with agent</span>
            </label>
            <button className="btn btn-primary" onClick={handleCreate}>
              Create Task
            </button>
          </div>
        )}

        {tasks?.length === 0 && !showForm && (
          <div className="empty-state">No tasks yet. Tap + to create one.</div>
        )}

        <ul className="item-list">
          {tasks?.map((t) => (
            <li key={t.id} className="item-row">
              <span className={`status-dot ${t.status}`} />
              <div style={{ flex: 1 }}>
                <div className="item-title">{t.title}</div>
                <div className="item-meta">
                  {t.mode} &middot; {t.status}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <OperatorsSection workspaceId={workspaceId} />
    </>
  );
}

function OperatorsSection({ workspaceId }: { workspaceId: string }) {
  const {
    data: operators,
    loading,
    reload,
  } = useAsync(() => getOperators(workspaceId), [workspaceId]);
  const { data: roles } = useAsync(getOperatorRoles, []);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('engineering');
  const [goal, setGoal] = useState('');

  const handleCreate = async () => {
    if (!name.trim() || !goal.trim()) return;
    haptic('success');
    await createOperator({ workspaceId, name: name.trim(), role, goal: goal.trim() });
    setName('');
    setGoal('');
    setShowForm(false);
    reload();
  };

  if (loading) return null;

  return (
    <div className="section">
      <div className="section-header-row">
        <span className="section-header">Operators ({operators?.length ?? 0})</span>
        <button
          className="btn-icon"
          onClick={() => {
            haptic('light');
            setShowForm(!showForm);
          }}
        >
          +
        </button>
      </div>

      {showForm && (
        <div className="form-card">
          <input
            className="input"
            placeholder="Operator name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="pill-row" style={{ marginBottom: 8 }}>
            {(
              roles ?? [
                { name: 'engineering' },
                { name: 'product' },
                { name: 'growth' },
                { name: 'design' },
                { name: 'ops' },
              ]
            ).map((r: OperatorRole | { name: string }) => (
              <button
                key={r.name}
                className={`pill ${role === r.name ? 'active' : ''}`}
                onClick={() => setRole(r.name)}
              >
                {r.name}
              </button>
            ))}
          </div>
          <textarea
            className="input textarea"
            placeholder="Goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
          <button className="btn btn-primary" onClick={handleCreate}>
            Create Operator
          </button>
        </div>
      )}

      <ul className="item-list">
        {operators?.map((op) => (
          <li key={op.id} className="item-row">
            <div>
              <div className="item-title">{op.name}</div>
              <div className="item-meta">
                {op.role} &middot; {op.goal}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Knowledge Tab ───

function KnowledgeTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KnowledgeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [pageTitle, setPageTitle] = useState('');
  const [pageType, setPageType] = useState('note');
  const [pageContent, setPageContent] = useState('');

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    const res = await searchKnowledge(query.trim());
    setResults(res);
    setSearching(false);
  };

  const handleCreate = async () => {
    if (!pageTitle.trim()) return;
    haptic('success');
    await createKnowledgePage({
      type: pageType,
      title: pageTitle.trim(),
      content: pageContent.trim() || undefined,
    });
    setPageTitle('');
    setPageContent('');
    setShowForm(false);
  };

  return (
    <>
      <div className="section">
        <div className="section-header">Search Knowledge</div>
        <div className="search-row">
          <input
            className="input"
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button className="btn btn-primary btn-sm" onClick={handleSearch} disabled={searching}>
            {searching ? '...' : 'Go'}
          </button>
        </div>

        {results && results.length === 0 && <div className="empty-state">No results found.</div>}
        {results && results.length > 0 && (
          <ul className="item-list">
            {results.map((r) => (
              <li key={r.id} className="item-row">
                <div className="item-title">{r.title}</div>
                <div className="item-meta">
                  {r.type} &middot; {(r.score * 100).toFixed(0)}% match
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="section">
        <div className="section-header-row">
          <span className="section-header">Create Page</span>
          <button
            className="btn-icon"
            onClick={() => {
              haptic('light');
              setShowForm(!showForm);
            }}
          >
            {showForm ? '\u2212' : '+'}
          </button>
        </div>
        {showForm && (
          <div className="form-card">
            <div className="pill-row" style={{ marginBottom: 8 }}>
              {['note', 'research', 'insight', 'decision'].map((t) => (
                <button
                  key={t}
                  className={`pill ${pageType === t ? 'active' : ''}`}
                  onClick={() => setPageType(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <input
              className="input"
              placeholder="Title"
              value={pageTitle}
              onChange={(e) => setPageTitle(e.target.value)}
            />
            <textarea
              className="input textarea"
              placeholder="Content (optional)"
              value={pageContent}
              onChange={(e) => setPageContent(e.target.value)}
            />
            <button className="btn btn-primary" onClick={handleCreate}>
              Save Page
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Apps Tab ───

function AppsTab({ workspaceId }: { workspaceId: string }) {
  const {
    data: apps,
    loading,
    reload,
  } = useAsync(() => getApplications(workspaceId), [workspaceId]);
  const [showForm, setShowForm] = useState(false);
  const [targetProgram, setTargetProgram] = useState('');

  const handleCreate = async () => {
    if (!targetProgram.trim()) return;
    haptic('success');
    await createApplication(workspaceId, targetProgram.trim());
    setTargetProgram('');
    setShowForm(false);
    reload();
  };

  const handleStatusChange = async (id: string, status: string) => {
    haptic('medium');
    await updateApplicationStatus(id, status);
    reload();
  };

  if (loading) return <div className="loading">Loading applications...</div>;

  return (
    <div className="section">
      <div className="section-header-row">
        <span className="section-header">Applications ({apps?.length ?? 0})</span>
        <button
          className="btn-icon"
          onClick={() => {
            haptic('light');
            setShowForm(!showForm);
          }}
        >
          +
        </button>
      </div>

      {showForm && (
        <div className="form-card">
          <input
            className="input"
            placeholder="Target program (e.g. YC S26, Techstars)"
            value={targetProgram}
            onChange={(e) => setTargetProgram(e.target.value)}
          />
          <button className="btn btn-primary" onClick={handleCreate}>
            Create
          </button>
        </div>
      )}

      {apps?.length === 0 && !showForm && <div className="empty-state">No applications yet.</div>}

      <ul className="item-list">
        {apps?.map((a) => (
          <li key={a.id} className="item-row">
            <div style={{ flex: 1 }}>
              <div className="item-title">{a.targetProgram}</div>
              <div className="item-meta">
                {a.status}{' '}
                {a.submittedAt
                  ? ` \u00b7 submitted ${new Date(a.submittedAt).toLocaleDateString()}`
                  : ''}
              </div>
            </div>
            {a.status === 'draft' && (
              <button
                className="btn btn-sm btn-outline"
                onClick={() => handleStatusChange(a.id, 'submitted')}
              >
                Submit
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Settings Tab ───

function SettingsTab({ workspaceId }: { workspaceId: string }) {
  const { data: profile } = useAsync(() => getProfile(workspaceId), [workspaceId]);
  const { data: settings, reload: reloadSettings } = useAsync(
    () => getSettings(workspaceId),
    [workspaceId],
  );
  const { data: launchBot, reload: reloadLaunchBot } = useAsync(
    () => getManagedTelegramState(workspaceId),
    [workspaceId],
  );
  const [editingBudget, setEditingBudget] = useState(false);
  const [budget, setBudget] = useState('');
  const [savingLaunchBot, setSavingLaunchBot] = useState(false);

  useEffect(() => {
    if (settings?.budgetConfig) {
      setBudget(
        String((settings.budgetConfig as Record<string, unknown>).monthlyLlmBudget ?? '100'),
      );
    }
  }, [settings]);

  const saveBudget = async () => {
    haptic('success');
    await updateSettings(workspaceId, {
      budgetConfig: { ...settings?.budgetConfig, monthlyLlmBudget: Number(budget) },
    });
    setEditingBudget(false);
    reloadSettings();
  };

  const createLaunchBot = async () => {
    haptic('medium');
    const request = await createManagedTelegramProvisioning(workspaceId);
    await reloadLaunchBot();
    if (request?.creationUrl) {
      window.Telegram?.WebApp.close();
      window.location.href = request.creationUrl;
    }
  };

  const setLaunchBotMode = async (
    mode: NonNullable<ManagedTelegramState['bot']>['responseMode'],
  ) => {
    haptic('success');
    setSavingLaunchBot(true);
    await updateManagedTelegramSettings(workspaceId, { responseMode: mode });
    await reloadLaunchBot();
    setSavingLaunchBot(false);
  };

  return (
    <>
      {profile && (
        <div className="section">
          <div className="section-header">Founder Profile</div>
          <div className="profile-card">
            <div className="avatar">{profile.name.charAt(0).toUpperCase()}</div>
            <div className="profile-info">
              <h3>{profile.name}</h3>
              <p>{profile.background ?? 'No background set'}</p>
            </div>
          </div>
          {profile.interests.length > 0 && (
            <div className="pill-row" style={{ marginTop: 12 }}>
              {profile.interests.map((interest, i) => (
                <span key={i} className="pill">
                  {interest}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="section">
        <div className="section-header">Budget</div>
        {editingBudget ? (
          <div className="form-card">
            <label className="input-label">Monthly LLM Budget (USD)</label>
            <input
              className="input"
              type="number"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={saveBudget}>
                Save
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => setEditingBudget(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="item-row" onClick={() => setEditingBudget(true)} role="button">
            <div>
              <div className="item-title">${budget}/mo</div>
              <div className="item-meta">Tap to edit</div>
            </div>
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-header">Model</div>
        <div className="item-row">
          <div>
            <div className="item-title">
              {String(
                (settings?.modelConfig as Record<string, unknown>)?.model ??
                  'anthropic/claude-sonnet-4-20250514',
              )}
            </div>
            <div className="item-meta">
              {String((settings?.modelConfig as Record<string, unknown>)?.provider ?? 'openrouter')}
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-header">Policy</div>
        <div className="item-row">
          <div>
            <div className="item-title">
              Max iterations:{' '}
              {String(
                (settings?.policyConfig as Record<string, unknown>)?.maxIterationBudget ?? 50,
              )}
            </div>
            <div className="item-meta">
              Blocked tools:{' '}
              {(
                ((settings?.policyConfig as Record<string, unknown>)?.blockedTools as string[]) ??
                []
              ).length === 0
                ? 'none'
                : (
                    (settings?.policyConfig as Record<string, unknown>)?.blockedTools as string[]
                  ).join(', ')}
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-header">Launch Bot</div>
        {!launchBot?.bot ? (
          <div className="item-row">
            <div style={{ flex: 1 }}>
              <div className="item-title">No launch/support bot connected</div>
              <div className="item-meta">
                {launchBot?.pendingRequest
                  ? `Pending @${launchBot.pendingRequest.suggestedUsername}`
                  : 'Create a founder-owned Telegram bot'}
              </div>
            </div>
            <button className="btn btn-sm btn-primary" onClick={createLaunchBot}>
              Create
            </button>
          </div>
        ) : (
          <>
            <div className="item-row">
              <div>
                <div className="item-title">@{launchBot.bot.telegramBotUsername}</div>
                <div className="item-meta">
                  {launchBot.bot.status} · {launchBot.leads.length} leads ·{' '}
                  {launchBot.messages.length} messages
                </div>
              </div>
            </div>
            <div className="pill-row" style={{ marginTop: 8 }}>
              {(['intake_only', 'approval_required', 'autonomous_helm'] as const).map((mode) => (
                <button
                  key={mode}
                  className={`pill ${launchBot.bot?.responseMode === mode ? 'active' : ''}`}
                  disabled={savingLaunchBot}
                  onClick={() => setLaunchBotMode(mode)}
                >
                  {mode.replace('_', ' ')}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="section">
        <div className="section-header">About</div>
        <div className="item-row">
          <div>
            <div className="item-title">HELM Pilot v0.1.0</div>
            <div className="item-meta">Open-source autonomous founder OS</div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Re-auth banner (Phase 13 Track C3) ───
//
// Polls /api/connectors/reauth-status. When the background refresh worker
// has marked any grant needs_reauth=true, the founder sees a dismissable
// banner with a CTA to reconnect. Dismissal is session-local so the banner
// reappears on next load if the grant is still broken.
function ReauthBanner({ workspaceId }: { workspaceId: string }) {
  const { data, reload } = useAsync(() => getReauthStatus(workspaceId), [workspaceId]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const id = setInterval(() => void reload(), 60_000);
    return () => clearInterval(id);
  }, [reload]);

  const grants = (data?.grants ?? []).filter((g: ReauthGrant) => !dismissed.has(g.grantId));
  if (grants.length === 0) return null;

  return (
    <div
      role="alert"
      className="section"
      style={{
        background: '#3a1f1f',
        border: '1px solid #5a2020',
        padding: 10,
        borderRadius: 8,
        margin: '8px 0',
      }}
    >
      {grants.map((g: ReauthGrant) => (
        <div
          key={g.grantId}
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}
        >
          <span style={{ flex: 1, fontSize: 13 }}>
            <strong>Reconnect {g.connectorName}</strong>
            <br />
            <span style={{ opacity: 0.7, fontSize: 11 }}>{g.lastError}</span>
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const next = new Set(dismissed);
              next.add(g.grantId);
              setDismissed(next);
            }}
            aria-label={`Dismiss ${g.connectorName} re-auth banner`}
            style={{ background: '#222', color: '#ededed', border: '1px solid #444' }}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
