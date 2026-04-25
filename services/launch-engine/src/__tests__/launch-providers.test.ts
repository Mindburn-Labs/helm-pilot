import { describe, it, expect, vi } from 'vitest';
import { LaunchChecklist } from '../checklist.js';
import { DistributionPlanner } from '../distribution.js';
import { DigitalOceanProvider } from '../providers/digitalocean.js';
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

describe('DigitalOceanProvider', () => {
  const digitalocean = new DigitalOceanProvider({ mock: true });

  it('provision returns a valid structure', async () => {
    const result = await digitalocean.provision({ appName: 'my-app', region: 'nyc3' });
    expect(result.providerId).toMatch(/[0-9a-f-]{36}/u);
    expect(result.appName).toBe('my-app');
    expect(result.region).toBe('nyc3');
    expect(result.status).toBe('provisioning');
    expect(result.dashboardUrl).toContain('https://cloud.digitalocean.com/apps/');
    expect(result.createdAt).toBeTruthy();
  });

  it('deploy returns a URL', async () => {
    const result = await digitalocean.deploy({
      providerId: '12345678-1234-1234-1234-123456789abc',
      image: 'registry.digitalocean.com/helm-pilot/my-app',
      tag: 'v1.0.0',
    });
    expect(result.url).toContain('ondigitalocean.app');
    expect(result.status).toBe('live');
    expect(result.version).toBe('v1.0.0');
    expect(result.deploymentId).toBeTruthy();
  });

  it('requires an app spec in real API mode', async () => {
    const realProvider = new DigitalOceanProvider({ token: 'dop_v1_test', mock: false });
    await expect(realProvider.provision({ appName: 'my-app', region: 'nyc3' })).rejects.toThrow(
      /config\.appSpec/,
    );
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
  const channels = [
    'producthunt',
    'hackernews',
    'twitter',
    'linkedin',
    'personal_network',
  ] as const;

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
