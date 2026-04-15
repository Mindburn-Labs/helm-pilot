/**
 * Embedding provider — generates vector embeddings for text.
 *
 * Primary: OpenAI text-embedding-3-small (1536 dims, cheap + good quality).
 * Fallback: hash-based pseudo-embedding for dev (deterministic, poor quality).
 *
 * All embeddings are 1536-dim (matches the vector column in the DB migration).
 */

export const EMBEDDING_DIM = 1536;

export interface EmbeddingProvider {
  /** Embed a single text string into a 1536-dim vector. */
  embed(text: string): Promise<number[]>;
  /** Embed multiple texts in a batch (more efficient). */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** Model identifier for audit/metrics. */
  readonly model: string;
}

export interface EmbeddingConfig {
  openaiApiKey?: string;
  voyageApiKey?: string;
  model?: string;
}

/**
 * Create an embedding provider from available API keys.
 * Returns a dev fallback if no keys are configured.
 */
export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  if (config.openaiApiKey) {
    return new OpenAIEmbeddingProvider(
      config.openaiApiKey,
      config.model ?? 'text-embedding-3-small',
    );
  }
  if (config.voyageApiKey) {
    return new VoyageEmbeddingProvider(
      config.voyageApiKey,
      config.model ?? 'voyage-3',
    );
  }
  // Dev fallback — deterministic hash-based pseudo-embedding
  return new HashEmbeddingProvider();
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model: string,
  ) {
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text]);
    if (!vec) throw new Error('Empty embedding response');
    return vec;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: EMBEDDING_DIM,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenAI embeddings error ${response.status}: ${body}`);
    }
    const data = (await response.json()) as {
      data?: { embedding: number[]; index: number }[];
    };
    if (!data.data) throw new Error('No embeddings in OpenAI response');
    // Sort by index to preserve input order
    return [...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model: string,
  ) {
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text]);
    if (!vec) throw new Error('Empty embedding response');
    return vec;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        output_dimension: EMBEDDING_DIM,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Voyage embeddings error ${response.status}: ${body}`);
    }
    const data = (await response.json()) as {
      data?: { embedding: number[] }[];
    };
    if (!data.data) throw new Error('No embeddings in Voyage response');
    return data.data.map((d) => d.embedding);
  }
}

/**
 * Dev-only deterministic pseudo-embedding based on text hashing.
 *
 * NOT semantically meaningful — identical vectors for similar text.
 * Only useful for testing pipeline wiring without a real embedding provider.
 */
class HashEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'hash-fallback';

  async embed(text: string): Promise<number[]> {
    const hash = hashString(text);
    const vec = new Array<number>(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      // Simple LCG seeded by hash + position
      const seed = (hash + i * 2654435761) >>> 0;
      vec[i] = (seed / 0xffffffff) * 2 - 1;
    }
    // Normalize to unit length (cosine similarity expects unit vectors)
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    return norm === 0 ? vec : vec.map((v) => v / norm);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

function hashString(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
  }
  return hash;
}
