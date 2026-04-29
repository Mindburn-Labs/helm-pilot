import { describe, expect, it } from 'vitest';
import { planMobileShipRun, renderMobileShipTelegramSummary } from './mobile-ship.js';

describe('mobile ship skill', () => {
  it('plans Expo Go preview without Apple submission approval', () => {
    const plan = planMobileShipRun({
      workspaceId: 'ws-1',
      founderTelegramId: 'tg-1',
      appName: 'Founder Brief',
      artifactPath: 'apps/founder-brief',
      target: 'expo_go',
    });

    expect(plan.easCommands).toContain('npx expo start --tunnel');
    expect(
      plan.helmActions.find((action) => action.action === 'mobile.apple_submit'),
    ).toMatchObject({
      requiresApproval: false,
    });
    expect(plan.telegramSummary).toContain('HELM approvals');
  });

  it('requires approval for TestFlight build and Apple submission', () => {
    const plan = planMobileShipRun({
      workspaceId: 'ws-1',
      founderTelegramId: 'tg-1',
      appName: 'Founder Brief',
      artifactPath: 'apps/founder-brief',
      target: 'testflight',
      expoProjectId: 'expo-123',
      appleBundleId: 'com.mindburn.founderbrief',
    });

    expect(plan.easCommands).toContain('npx eas build --platform ios --profile preview');
    expect(plan.easCommands).toContain(
      'npx eas submit --platform ios --latest --apple-team-id $APPLE_TEAM_ID',
    );
    expect(plan.helmActions.filter((action) => action.requiresApproval)).toHaveLength(2);
  });

  it('renders Telegram summary with supplied release notes', () => {
    const summary = renderMobileShipTelegramSummary(
      {
        workspaceId: 'ws-1',
        founderTelegramId: 'tg-1',
        appName: 'Founder Brief',
        artifactPath: 'apps/founder-brief',
        target: 'app_store',
      },
      'Launch candidate 3',
    );

    expect(summary).toContain('Target: App Store submission');
    expect(summary).toContain('Release notes: Launch candidate 3');
  });
});
