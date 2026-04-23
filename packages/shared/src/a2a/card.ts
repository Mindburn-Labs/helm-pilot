import {
  A2A_PROTOCOL_VERSION,
  type AgentCard,
  type AgentSkill,
} from './types.js';

// ─── Agent card builder (Phase 15 Track J) ───
//
// Produces Pilot's /.well-known/agent-card.json document. Skills are
// derived from the hard-coded Pilot capability set for v1; a follow-up
// commit can wire them to the SubagentRegistry so customers who swap
// packs see their skills advertised.

export interface BuildAgentCardInput {
  /** Public URL where Pilot answers A2A JSON-RPC (e.g. https://pilot.example.com/a2a). */
  url: string;
  /** Semver of the Pilot binary — read from root package.json at caller site. */
  version: string;
  /** Defaults to 'bearer' so external callers know to present a token. */
  authSchemes?: Array<'none' | 'bearer' | 'oauth2'>;
  /** Optional provider metadata. */
  organization?: string;
  organizationUrl?: string;
}

const PILOT_SKILLS: AgentSkill[] = [
  {
    id: 'opportunity.discover',
    name: 'Discover opportunities',
    description:
      'Scan YC batches, Hacker News, and Product Hunt for startup opportunities aligned with a founder profile.',
    examples: [
      'Find YC W26 companies working on AI coding tools',
      'List recent Product Hunt fintech launches',
    ],
    inputModes: ['text'],
    outputModes: ['text', 'data'],
  },
  {
    id: 'founder.diagnose',
    name: 'Diagnose founder readiness',
    description:
      'Evaluate a founder profile (skills, experience, network) against market opportunities and surface gaps.',
    examples: ['What is missing from my profile to run an AI infra startup?'],
    inputModes: ['text'],
    outputModes: ['text'],
  },
  {
    id: 'decision.facilitate',
    name: 'Facilitate decisions',
    description:
      'Run an adversarial bull/bear debate against a strategic decision (hire, pivot, raise) and return a recommendation + key risks.',
    examples: ['Should we pivot from B2C to B2B given the latest metrics?'],
    inputModes: ['text'],
    outputModes: ['text', 'data'],
  },
  {
    id: 'product.build',
    name: 'Build product surfaces',
    description:
      'Scaffold landing pages, pitch decks, YC applications, or launch copy on demand.',
    examples: ['Draft a one-page landing for our embedded-finance product'],
    inputModes: ['text'],
    outputModes: ['text'],
  },
  {
    id: 'knowledge.search',
    name: 'Search founder knowledge',
    description:
      'Hybrid semantic + keyword search across the workspace knowledge layer (notes, timeline, compiled truths).',
    examples: ['What did the team conclude about pricing in Q1?'],
    inputModes: ['text'],
    outputModes: ['text', 'data'],
  },
];

export function buildPilotAgentCard(input: BuildAgentCardInput): AgentCard {
  const authSchemes = input.authSchemes ?? ['bearer'];
  return {
    name: 'HELM Pilot',
    description:
      'Autonomous founder operating system. Runs behind the HELM trust boundary — every autonomous action emits a signed evidence pack.',
    url: input.url,
    protocolVersion: A2A_PROTOCOL_VERSION,
    version: input.version,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    authentication: { schemes: authSchemes },
    skills: PILOT_SKILLS,
    defaultInputModes: ['text'],
    defaultOutputModes: ['text', 'data'],
    provider: input.organization
      ? {
          organization: input.organization,
          url: input.organizationUrl,
        }
      : undefined,
  };
}
