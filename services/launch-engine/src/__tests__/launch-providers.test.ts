import { describe, it, expect, vi } from 'vitest';
import { LaunchChecklist } from '../checklist.js';
import { DistributionPlanner } from '../distribution.js';
import { FlyProvider } from '../providers/fly.js';
import { VercelProvider } from '../providers/vercel.js';
import type { LlmProvider } from '@helm-pilot/shared/llm';

describe('LaunchChecklist', () => {
  const checklist = new LaunchChecklist();

  it('generates 12+ items across 4+ categories', () => {
    const items = checklist.generateChecklist({ title: 'Acme App', techStack: 'Next.js' });
    expect(items.length).toBeGreaterThanOrEqual(12);

    const categories = new Set(items.map((i) => i.category));
    expect(categories.size).toBeGreaterThanOrEqual(4);
  });

  it('marks all domain and legal items as required', () => {
    const items = checklist.generateChecklist({ title: 'Acme App', techStack: 'Next.js' });
    const domainItems = items.filter((i) => i.category === 'domain');
    const legalItems = items.filter((i) => i.category === 'legal');

    expect(domainItems.length).toBeGreaterThan(0);
    expect(legalItems.length).toBeGreaterThan(0);
    for (const item of [...domainItems, ...legalItems]) {
      expect(item.required).toBe(true);
    }
  });
});

describe('FlyProvider', () => {
  const fly = new FlyProvider();

  it('provision returns a valid structure', async () => {
    const result = await fly.provision({ appName: 'my-app', region: 'iad' });
    expect(result.providerId).toContain('fly_my-app');
    expect(result.appName).toBe('my-app');
    expect(result.region).toBe('iad');
    expect(result.status).toBe('provisioning');
    expect(result.dashboardUrl).toBe('https://fly.io/apps/my-app');
    expect(result.createdAt).toBeTruthy();
  });

  it('deploy returns a URL', async () => {
    const result = await fly.deploy({
      providerId: 'fly_my-app_123',
      image: 'registry.fly.io/my-app',
      tag: 'v1.0.0',
    });
    expect(result.url).toContain('fly.dev');
    expect(result.status).toBe('live');
    expect(result.version).toBe('v1.0.0');
    expect(result.deploymentId).toBeTruthy();
  });
});

describe('VercelProvider', () => {
  const vercel = new VercelProvider();

  it('provision returns a realistic structure', async () => {
    const result = await vercel.provision({ appName: 'my-site', region: 'iad1' });
    expect(result.providerId).toMatch(/^prj_/);
    expect(result.appName).toBe('my-site');
    expect(result.dashboardUrl).toContain('vercel.com');
    expect(result.status).toBe('provisioning');
  });
});

describe('DistributionPlanner', () => {
  const planner = new DistributionPlanner();
  const channels = ['producthunt', 'hackernews', 'twitter', 'linkedin', 'personal_network'] as const;

  it('generates drafts for all requested channels', async () => {
    const plan = await planner.planDistribution({
      title: 'TestApp',
      description: 'A testing tool',
      targetChannels: [...channels],
    });
    expect(plan.drafts).toHaveLength(channels.length);

    const draftChannels = new Set(plan.drafts.map((d) => d.channel));
    for (const ch of channels) {
      expect(draftChannels.has(ch)).toBe(true);
    }
  });

  it('marks all external drafts with requiresApproval=true', async () => {
    const plan = await planner.planDistribution({
      title: 'TestApp',
      description: 'A testing tool',
      targetChannels: [...channels],
    });
    for (const draft of plan.drafts) {
      expect(draft.requiresApproval).toBe(true);
    }
  });

  it('falls back to templates when LLM fails', async () => {
    const failingLlm: LlmProvider = {
      complete: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
      completeWithUsage: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
    };

    const plan = await planner.planDistribution(
      { title: 'TestApp', description: 'A tool', targetChannels: ['twitter'] },
      failingLlm,
    );
    expect(plan.drafts).toHaveLength(1);
    expect(plan.drafts[0]!.channel).toBe('twitter');
    expect(plan.llmGenerated).toBe(false);
  });
});
