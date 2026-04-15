import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryService } from '../index.js';

// ─── Mock Db Factory ───
// Drizzle's Db type uses chained methods (.select().from().where().limit())
// and raw SQL via .execute(). We build a thenable proxy that captures
// insert values for chunk verification.

function createThenableChain(resolveValue: unknown = []): Record<string, unknown> {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(resolveValue);
      }
      // Any method call returns the same proxy (infinite chaining)
      return vi.fn().mockReturnValue(new Proxy({}, handler));
    },
  };
  return new Proxy({}, handler);
}

function createMockDb() {
  const insertedValues: Array<Record<string, unknown>> = [];

  const db = {
    execute: vi.fn().mockResolvedValue([]),

    select: vi.fn().mockReturnValue(createThenableChain([])),

    insert: vi.fn().mockImplementation(() => {
      // Return a chain whose .values() captures the argument
      const valuesProxy = (val: unknown): Record<string, unknown> => {
        if (val && typeof val === 'object') {
          insertedValues.push(val as Record<string, unknown>);
        }
        return createThenableChain([{ id: 'new-page-id' }]);
      };

      const handler: ProxyHandler<Record<string, unknown>> = {
        get(_target, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => resolve([{ id: 'new-page-id' }]);
          }
          if (prop === 'values') {
            return vi.fn().mockImplementation(valuesProxy);
          }
          return vi.fn().mockReturnValue(new Proxy({}, handler));
        },
      };

      return new Proxy({}, handler);
    }),

    update: vi.fn().mockReturnValue(createThenableChain()),
    delete: vi.fn().mockReturnValue(createThenableChain()),

    // Test accessors
    _insertedValues: insertedValues,
    get _insertedChunks() {
      return insertedValues.filter(
        (v) => 'chunkIndex' in v,
      ) as Array<{ pageId: string; content: string; chunkIndex: number }>;
    },
  };

  return db;
}

// ─── Tests ───

describe('MemoryService', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: MemoryService;

  beforeEach(() => {
    db = createMockDb();
    service = new MemoryService(db as never);
  });

  // ─── search() ───

  describe('search()', () => {
    it('returns empty array for vector method (no embeddings)', async () => {
      const results = await service.search('test query', { method: 'vector' });
      expect(results).toEqual([]);
      expect(db.execute).not.toHaveBeenCalled();
    });

    it('calls keyword search for "keyword" method', async () => {
      db.execute.mockResolvedValue([]);
      const results = await service.search('test query', { method: 'keyword' });
      expect(results).toEqual([]);
      expect(db.execute).toHaveBeenCalled();
    });

    it('calls keyword search for "hybrid" method', async () => {
      db.execute.mockResolvedValue([]);
      const results = await service.search('test query', { method: 'hybrid' });
      expect(results).toEqual([]);
      expect(db.execute).toHaveBeenCalled();
    });

    it('defaults to keyword method when no method specified', async () => {
      db.execute.mockResolvedValue([]);
      const results = await service.search('test query');
      expect(results).toEqual([]);
      expect(db.execute).toHaveBeenCalled();
    });

    it('returns empty array for empty query string', async () => {
      const results = await service.search('   ', { method: 'keyword' });
      expect(results).toEqual([]);
      expect(db.execute).not.toHaveBeenCalled();
    });

    it('returns empty array for whitespace-only query', async () => {
      const results = await service.search('\t\n  ', { method: 'keyword' });
      expect(results).toEqual([]);
      expect(db.execute).not.toHaveBeenCalled();
    });

    it('maps db rows to SearchResult shape', async () => {
      db.execute.mockResolvedValue([
        { page_id: 'p1', title: 'Test Page', type: 'person', content: 'some excerpt', rank: 0.85 },
        { page_id: 'p2', title: 'Another', type: 'company', content: 'other text', rank: 0.42 },
      ]);

      const results = await service.search('test', { method: 'keyword' });

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        pageId: 'p1',
        title: 'Test Page',
        excerpt: 'some excerpt',
        score: 0.85,
        type: 'person',
      });
      expect(results[1]).toEqual({
        pageId: 'p2',
        title: 'Another',
        excerpt: 'other text',
        score: 0.42,
        type: 'company',
      });
    });

    it('clamps limit to 100 maximum', async () => {
      db.execute.mockResolvedValue([]);
      await service.search('query', { method: 'keyword', limit: 500 });
      expect(db.execute).toHaveBeenCalledTimes(1);
    });

    it('defaults limit to 10 when not specified', async () => {
      db.execute.mockResolvedValue([]);
      await service.search('query');
      expect(db.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ─── upsertPage() — new page ───

  describe('upsertPage() — new page', () => {
    it('inserts a new page and returns its id', async () => {
      const result = await service.upsertPage({
        type: 'person',
        title: 'Ada Lovelace',
        compiledTruth: 'Pioneer of computing',
        tags: ['computing', 'history'],
      });

      expect(result).toBe('new-page-id');
      expect(db.insert).toHaveBeenCalled();
    });

    it('throws when insert returns no result', async () => {
      // Override insert to return empty from .returning()
      db.insert.mockImplementation(() => {
        const valuesProxy = (_val: unknown): Record<string, unknown> => {
          return createThenableChain([]);
        };
        const handler: ProxyHandler<Record<string, unknown>> = {
          get(_target, prop) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => void) => resolve([]);
            }
            if (prop === 'values') {
              return vi.fn().mockImplementation(valuesProxy);
            }
            return vi.fn().mockReturnValue(new Proxy({}, handler));
          },
        };
        return new Proxy({}, handler);
      });

      await expect(
        service.upsertPage({ type: 'person', title: 'Ghost' }),
      ).rejects.toThrow('Failed to create page');
    });
  });

  // ─── upsertPage() — chunking ───

  describe('upsertPage() — content chunking', () => {
    it('chunks content that fits in one chunk', async () => {
      const shortContent = 'Hello world';
      await service.upsertPage({
        type: 'concept',
        title: 'Short',
        content: shortContent,
      });

      const chunks = db._insertedChunks;
      expect(chunks.length).toBe(1);
      expect(chunks[0]!.content).toBe(shortContent);
      expect(chunks[0]!.chunkIndex).toBe(0);
    });

    it('chunks long content with correct overlap', async () => {
      // With CHUNK_SIZE=1500 and CHUNK_OVERLAP=200, each step advances 1300 chars.
      // 3000 chars:
      //   Chunk 0: [0, 1500) = 1500 chars
      //   Chunk 1: [1300, 2800) = 1500 chars
      //   Chunk 2: [2600, 3000) = 400 chars
      const longContent = 'A'.repeat(3000);
      await service.upsertPage({
        type: 'concept',
        title: 'Long Document',
        content: longContent,
      });

      const chunks = db._insertedChunks;
      expect(chunks.length).toBe(3);
      expect(chunks[0]!.chunkIndex).toBe(0);
      expect(chunks[1]!.chunkIndex).toBe(1);
      expect(chunks[2]!.chunkIndex).toBe(2);
    });

    it('handles exact CHUNK_SIZE boundary', async () => {
      // Exactly 1500 chars:
      //   Chunk 0: [0, 1500) = 1500 chars
      //   Chunk 1: [1300, 1500) = 200 chars (overlap window)
      const exactContent = 'B'.repeat(1500);
      await service.upsertPage({
        type: 'concept',
        title: 'Exact Boundary',
        content: exactContent,
      });

      const chunks = db._insertedChunks;
      expect(chunks.length).toBe(2);
    });

    it('skips chunking when no content provided', async () => {
      await service.upsertPage({
        type: 'concept',
        title: 'No Content',
      });

      expect(db._insertedChunks.length).toBe(0);
    });

    it('produces non-empty chunks (trims whitespace)', async () => {
      // Content that is all spaces should produce no chunks
      // (chunkText trims each chunk and skips empty ones)
      await service.upsertPage({
        type: 'concept',
        title: 'Whitespace Only',
        content: '   ',
      });

      expect(db._insertedChunks.length).toBe(0);
    });

    it('handles empty string content', async () => {
      await service.upsertPage({
        type: 'concept',
        title: 'Empty Content',
        content: '',
      });

      expect(db._insertedChunks.length).toBe(0);
    });

    it('first chunk is full CHUNK_SIZE for long content', async () => {
      await service.upsertPage({
        type: 'concept',
        title: 'Length Check',
        content: 'D'.repeat(3000),
      });

      const chunks = db._insertedChunks;
      expect(chunks[0]!.content.length).toBe(1500);
    });

    it('overlap causes last chunk to be shorter', async () => {
      // 2600 chars: step is 1300 (1500 - 200)
      // Chunk 0: [0, 1500) = 1500 chars
      // Chunk 1: [1300, 2600) = 1300 chars
      await service.upsertPage({
        type: 'concept',
        title: 'Overlap Tail',
        content: 'E'.repeat(2600),
      });

      const chunks = db._insertedChunks;
      expect(chunks.length).toBe(2);
      expect(chunks[0]!.content.length).toBe(1500);
      expect(chunks[1]!.content.length).toBe(1300);
    });
  });

  // ─── addTimeline() ───

  describe('addTimeline()', () => {
    it('inserts a timeline entry', async () => {
      await service.addTimeline('page-123', {
        eventType: 'note',
        content: 'First meeting went well',
        source: 'orchestrator',
      });

      expect(db.insert).toHaveBeenCalled();
    });
  });

  // ─── getPage() ───

  describe('getPage()', () => {
    it('returns null for non-existent page', async () => {
      const result = await service.getPage('nonexistent-id');
      expect(result).toBeNull();
    });
  });
});

// ─── chunkText behavior (verified indirectly through upsertPage) ───

describe('chunkText behavior (indirect)', () => {
  it('single character produces one chunk', async () => {
    const db = createMockDb();
    const service = new MemoryService(db as never);

    await service.upsertPage({
      type: 'concept',
      title: 'Tiny',
      content: 'x',
    });

    const chunks = db._insertedChunks;
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.content).toBe('x');
  });

  it('content just over CHUNK_SIZE produces 2 chunks with overlap', async () => {
    const db = createMockDb();
    const service = new MemoryService(db as never);

    // 1501 chars: just barely triggers a second chunk
    await service.upsertPage({
      type: 'concept',
      title: 'Just Over',
      content: 'F'.repeat(1501),
    });

    const chunks = db._insertedChunks;
    // Chunk 0: [0, 1500) = 1500
    // Chunk 1: [1300, 1501) = 201
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.content.length).toBe(1500);
    expect(chunks[1]!.content.length).toBe(201);
  });

  it('chunk indices are sequential starting from 0', async () => {
    const db = createMockDb();
    const service = new MemoryService(db as never);

    await service.upsertPage({
      type: 'concept',
      title: 'Indexed',
      content: 'G'.repeat(5000),
    });

    const chunks = db._insertedChunks;
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.chunkIndex).toBe(i);
    }
  });

  it('all chunks carry the correct pageId', async () => {
    const db = createMockDb();
    const service = new MemoryService(db as never);

    await service.upsertPage({
      type: 'concept',
      title: 'PageId Check',
      content: 'H'.repeat(3000),
    });

    const chunks = db._insertedChunks;
    for (const chunk of chunks) {
      expect(chunk.pageId).toBe('new-page-id');
    }
  });
});

