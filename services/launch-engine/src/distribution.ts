import type { LlmProvider } from '@helm-pilot/shared/llm';

export type DistributionChannel =
  | 'producthunt'
  | 'hackernews'
  | 'twitter'
  | 'linkedin'
  | 'personal_network';

export interface ChannelDraft {
  channel: DistributionChannel;
  draft: string;
  requiresApproval: true;
}

export interface DistributionPlanParams {
  title: string;
  description: string;
  targetChannels: DistributionChannel[];
}

export interface DistributionPlan {
  drafts: ChannelDraft[];
  generatedAt: string;
  llmGenerated: boolean;
}

const TEMPLATES: Record<DistributionChannel, (title: string, description: string) => string> = {
  producthunt: (title, description) =>
    `${title} -- ${description}\n\nWe built ${title} to solve a real problem. Try it today and let us know what you think!`,
  hackernews: (title, description) =>
    `Show HN: ${title}\n\n${description}\n\nWould love feedback from the HN community.`,
  twitter: (title, description) =>
    `Launching ${title} today!\n\n${description}\n\nCheck it out and let us know what you think.`,
  linkedin: (title, description) =>
    `Excited to announce the launch of ${title}.\n\n${description}\n\nWe'd love your feedback -- try it out and share your thoughts.`,
  personal_network: (title, description) =>
    `Hey! I just launched ${title}.\n\n${description}\n\nWould really appreciate if you could check it out and share any feedback.`,
};

export class DistributionPlanner {
  planDistribution(
    params: DistributionPlanParams,
    llm?: LlmProvider,
  ): Promise<DistributionPlan> {
    if (llm) {
      return this.generateWithLlm(params, llm);
    }
    return this.generateFromTemplates(params);
  }

  private async generateFromTemplates(
    params: DistributionPlanParams,
  ): Promise<DistributionPlan> {
    const drafts: ChannelDraft[] = params.targetChannels.map((channel) => ({
      channel,
      draft: TEMPLATES[channel](params.title, params.description),
      requiresApproval: true as const,
    }));

    return {
      drafts,
      generatedAt: new Date().toISOString(),
      llmGenerated: false,
    };
  }

  private async generateWithLlm(
    params: DistributionPlanParams,
    llm: LlmProvider,
  ): Promise<DistributionPlan> {
    try {
      const drafts: ChannelDraft[] = [];

      for (const channel of params.targetChannels) {
        const prompt = [
          `Write a launch announcement for "${params.title}" on ${channel}.`,
          `Product description: ${params.description}`,
          `Keep the tone appropriate for ${channel}. Be concise. Return only the post text, no commentary.`,
        ].join('\n');

        const content = await llm.complete(prompt);
        drafts.push({
          channel,
          draft: content.trim(),
          requiresApproval: true as const,
        });
      }

      return {
        drafts,
        generatedAt: new Date().toISOString(),
        llmGenerated: true,
      };
    } catch {
      // Graceful fallback: if LLM fails, use templates instead
      return this.generateFromTemplates(params);
    }
  }
}
