import { MultimodalError } from './pdf.js';

// ─── Image analyzer via Anthropic vision (Phase 15 Track K) ───
//
// Direct fetch to the Messages API with an `image` content block. We
// intentionally avoid the @anthropic-ai/sdk dep for the smallest
// footprint — Pilot already speaks JSON over HTTP to every other
// provider. API key via `ANTHROPIC_API_KEY` env or param override.

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface ImageAnalysis {
  /** Model's free-text answer to the question. */
  text: string;
  /** Token usage — lets the caller attribute cost. */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Model that produced the analysis. */
  model: string;
}

export interface AnalyzeImageParams {
  /** Base64-encoded image bytes (no `data:` prefix). */
  imageBase64: string;
  mediaType: ImageMediaType;
  /** Natural-language question to ask about the image. */
  question: string;
  /** Override model. Default is current Claude Sonnet. */
  model?: string;
  /** Override API key (otherwise reads `ANTHROPIC_API_KEY`). */
  apiKey?: string;
  /** Soft cap on output tokens. Default 1024. */
  maxTokens?: number;
}

export async function analyzeImage(params: AnalyzeImageParams): Promise<ImageAnalysis> {
  if (!params.imageBase64 || params.imageBase64.length === 0) {
    throw new MultimodalError('imageBase64 required', 'invalid_input');
  }
  if (!params.question || params.question.trim().length === 0) {
    throw new MultimodalError('question required', 'invalid_input');
  }
  const apiKey = params.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new MultimodalError(
      'ANTHROPIC_API_KEY is not configured. Vision analysis is unavailable.',
      'not_installed',
    );
  }
  const model = params.model ?? DEFAULT_MODEL;
  const maxTokens = Math.max(64, Math.min(8192, params.maxTokens ?? 1024));
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: params.mediaType,
              data: params.imageBase64,
            },
          },
          { type: 'text', text: params.question },
        ],
      },
    ],
  };
  let response: Response;
  try {
    response = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new MultimodalError(
      `Vision request failed: ${err instanceof Error ? err.message : String(err)}`,
      'vision_failed',
    );
  }
  if (!response.ok) {
    throw new MultimodalError(
      `Vision API HTTP ${response.status}`,
      'vision_failed',
    );
  }
  const json = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    model?: string;
  };
  const text = (json.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n\n');
  return {
    text,
    usage: {
      inputTokens: Number(json.usage?.input_tokens ?? 0),
      outputTokens: Number(json.usage?.output_tokens ?? 0),
    },
    model: json.model ?? model,
  };
}
