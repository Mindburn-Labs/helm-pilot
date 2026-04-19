import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServerRegistry, McpError } from '../mcp/index.js';

// ─── McpServerRegistry tests (Phase 14 Track A) ───

const createdTmpDirs: string[] = [];
afterEach(() => {
  for (const d of createdTmpDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'mcp-registry-'));
  createdTmpDirs.push(d);
  return d;
}

describe('McpServerRegistry.loadFromDisk', () => {
  it('returns empty registry when the config file is missing', () => {
    const reg = McpServerRegistry.loadFromDisk(join(mkTmp(), 'does-not-exist.json'));
    expect(reg.listNames()).toEqual([]);
  });

  it('parses a JSON config with stdio + http entries', () => {
    const dir = mkTmp();
    const path = join(dir, 'servers.json');
    writeFileSync(
      path,
      JSON.stringify({
        github: {
          transport: 'stdio',
          command: 'echo',
          args: ['hi'],
        },
        filesystem: {
          transport: 'http',
          url: 'http://127.0.0.1:0/mcp',
        },
      }),
    );
    const reg = McpServerRegistry.loadFromDisk(path);
    expect(reg.listNames().sort()).toEqual(['filesystem', 'github']);
    expect(reg.has('github')).toBe(true);
    expect(reg.has('missing')).toBe(false);
  });

  it('throws McpError on malformed JSON', () => {
    const dir = mkTmp();
    const path = join(dir, 'bad.json');
    writeFileSync(path, '{ not valid json');
    expect(() => McpServerRegistry.loadFromDisk(path)).toThrow(McpError);
  });

  it('throws McpError when top-level is an array (not object)', () => {
    const dir = mkTmp();
    const path = join(dir, 'array.json');
    writeFileSync(path, '[]');
    expect(() => McpServerRegistry.loadFromDisk(path)).toThrow(
      /must be a JSON object/,
    );
  });
});

describe('McpServerRegistry.get', () => {
  it('rejects unknown server names with not_configured McpError', async () => {
    const reg = new McpServerRegistry({});
    await expect(reg.get('ghost')).rejects.toMatchObject({
      name: 'McpError',
      code: 'not_configured',
    });
  });
});
