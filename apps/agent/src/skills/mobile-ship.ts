export type MobileShipTarget = 'expo_go' | 'testflight' | 'app_store';

export interface MobileShipInput {
  workspaceId: string;
  founderTelegramId: string;
  appName: string;
  artifactPath: string;
  target: MobileShipTarget;
  expoProjectId?: string;
  appleBundleId?: string;
  releaseNotes?: string;
}

export interface MobileShipHelmAction {
  action: string;
  resource: string;
  effectLevel: 'read' | 'write' | 'deploy' | 'publish';
  requiresApproval: boolean;
  reason: string;
}

export interface MobileShipPlan {
  workspaceId: string;
  appName: string;
  target: MobileShipTarget;
  telegramSummary: string;
  steps: readonly string[];
  helmActions: readonly MobileShipHelmAction[];
  easCommands: readonly string[];
}

const TARGET_LABELS: Record<MobileShipTarget, string> = {
  expo_go: 'Expo Go preview',
  testflight: 'TestFlight beta',
  app_store: 'App Store submission',
};

export function planMobileShipRun(input: MobileShipInput): MobileShipPlan {
  validateMobileShipInput(input);
  const releaseNotes = input.releaseNotes?.trim() || `HELM Pilot mobile build for ${input.appName}`;
  const needsAppleIdentity = input.target === 'testflight' || input.target === 'app_store';
  const appleResource = input.appleBundleId ?? `${input.appName}.bundle-id.pending`;
  const easCommands = [
    `cd ${input.artifactPath}`,
    'npx expo install --check',
    input.target === 'expo_go'
      ? 'npx expo start --tunnel'
      : `npx eas build --platform ios --profile ${input.target === 'testflight' ? 'preview' : 'production'}`,
    ...(input.target === 'testflight'
      ? ['npx eas submit --platform ios --latest --apple-team-id $APPLE_TEAM_ID']
      : []),
    ...(input.target === 'app_store'
      ? [
          'npx eas submit --platform ios --latest --apple-team-id $APPLE_TEAM_ID --asc-app-id $ASC_APP_ID',
        ]
      : []),
  ];

  return {
    workspaceId: input.workspaceId,
    appName: input.appName,
    target: input.target,
    telegramSummary: renderMobileShipTelegramSummary(input, releaseNotes),
    steps: [
      'Accept Telegram request from founder control surface.',
      'Validate Expo project metadata and dependency health.',
      'Create a HELM approval for any external build, submit, or publish action.',
      `Prepare ${TARGET_LABELS[input.target]} commands without reading secrets into the chat transcript.`,
      'Post receipt ids and EAS build references back to Telegram after approval.',
    ],
    helmActions: [
      {
        action: 'mobile.validate_expo_project',
        resource: input.artifactPath,
        effectLevel: 'read',
        requiresApproval: false,
        reason: 'Project metadata inspection is read-only.',
      },
      {
        action: 'mobile.eas_build',
        resource: input.expoProjectId ?? input.artifactPath,
        effectLevel: 'deploy',
        requiresApproval: input.target !== 'expo_go',
        reason:
          input.target === 'expo_go'
            ? 'Local Expo preview does not publish a binary.'
            : 'External EAS build consumes account quota and produces a distributable binary.',
      },
      {
        action: 'mobile.apple_submit',
        resource: appleResource,
        effectLevel: input.target === 'app_store' ? 'publish' : 'deploy',
        requiresApproval: needsAppleIdentity,
        reason: needsAppleIdentity
          ? 'Apple submission touches a founder-owned developer account.'
          : 'Expo Go preview skips Apple submission.',
      },
    ],
    easCommands,
  };
}

export function renderMobileShipTelegramSummary(
  input: MobileShipInput,
  releaseNotes = input.releaseNotes?.trim() || `HELM Pilot mobile build for ${input.appName}`,
): string {
  return [
    `Mobile ship request: ${input.appName}`,
    `Target: ${TARGET_LABELS[input.target]}`,
    `Artifact: ${input.artifactPath}`,
    `Founder Telegram: ${input.founderTelegramId}`,
    `Release notes: ${releaseNotes}`,
    'HELM approvals: required before EAS build, TestFlight, or App Store submission.',
  ].join('\n');
}

function validateMobileShipInput(input: MobileShipInput): void {
  if (!input.workspaceId) throw new Error('workspaceId is required');
  if (!input.founderTelegramId) throw new Error('founderTelegramId is required');
  if (!input.appName) throw new Error('appName is required');
  if (!input.artifactPath) throw new Error('artifactPath is required');
  if (!Object.hasOwn(TARGET_LABELS, input.target)) {
    throw new Error(`Unsupported mobile ship target: ${input.target}`);
  }
}
