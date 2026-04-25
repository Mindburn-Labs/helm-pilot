#!/usr/bin/env tsx
/**
 * install-skill — fetch + verify + install a skill from a registry URL.
 *
 * Usage: npm run skills:install -- <skill-name>
 * Env:   HELM_SKILLS_REGISTRY_URL (required) — base URL (no trailing slash)
 *                                 e.g. https://skills.helm-pilot.dev
 * Exit:  0 = installed cleanly
 *        1 = SHA-256 verify failed or bad manifest
 *        2 = network / transport error / arg parse
 *
 * Install path: ~/.helm-pilot/skills/<name>/
 * Matches OpenClaw ClawHub precedence: bundled (packs/skills) → user
 * override (~/.helm-pilot/skills) → subagent frontmatter inline.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

async function main() {
  const name = process.argv[2];
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error('Usage: install-skill <skill-name>  (lowercase letters, digits, hyphens only)');
    process.exit(2);
  }
  const registry = process.env['HELM_SKILLS_REGISTRY_URL'];
  if (!registry) {
    console.error('HELM_SKILLS_REGISTRY_URL is required.');
    process.exit(2);
  }
  const base = registry.replace(/\/$/, '');
  const tarballUrl = `${base}/${name}.tar.gz`;
  const manifestUrl = `${base}/${name}.sha256`;

  // 1. Fetch SHA-256 manifest.
  console.log(`Fetching manifest: ${manifestUrl}`);
  const manifestRes = await fetch(manifestUrl);
  if (!manifestRes.ok) {
    console.error(`Manifest HTTP ${manifestRes.status}`);
    process.exit(2);
  }
  const expectedHash = (await manifestRes.text()).trim().split(/\s+/)[0];
  if (!expectedHash || !/^[0-9a-f]{64}$/.test(expectedHash)) {
    console.error(`Manifest does not contain a valid SHA-256 hex digest: "${expectedHash}"`);
    process.exit(1);
  }
  console.log(`Expected SHA-256: ${expectedHash}`);

  // 2. Fetch tarball into memory + hash it.
  console.log(`Fetching tarball:  ${tarballUrl}`);
  const tarballRes = await fetch(tarballUrl);
  if (!tarballRes.ok) {
    console.error(`Tarball HTTP ${tarballRes.status}`);
    process.exit(2);
  }
  const buffer = Buffer.from(await tarballRes.arrayBuffer());
  const actualHash = createHash('sha256').update(buffer).digest('hex');
  if (actualHash !== expectedHash) {
    console.error(`SHA-256 mismatch. Expected ${expectedHash}, got ${actualHash}`);
    process.exit(1);
  }
  console.log(`Integrity verified (${buffer.byteLength} bytes).`);

  // 3. Validate archive paths, then extract into a staging dir via system tar.
  const installDir = join(homedir(), '.helm-pilot', 'skills', name);
  const tmpTarball = join(tmpdir(), `helm-skill-${name}-${Date.now()}.tar.gz`);
  const stagingDir = join(tmpdir(), `helm-skill-${name}-${Date.now()}-staging`);
  writeFileSync(tmpTarball, buffer);
  mkdirSync(stagingDir, { recursive: true });

  console.log('Validating archive paths');
  const entries = await listTarballEntries(tmpTarball);
  for (const entry of entries) {
    assertSafeTarEntry(entry);
  }

  console.log(`Extracting to: ${installDir}`);
  await runTar(['-xzf', tmpTarball, '-C', stagingDir]);

  mkdirSync(dirname(installDir), { recursive: true });
  if (existsSync(installDir)) rmSync(installDir, { recursive: true, force: true });
  renameSync(stagingDir, installDir);

  // 4. Write install manifest.
  writeFileSync(
    join(installDir, '.install.json'),
    JSON.stringify(
      {
        name,
        installedAt: new Date().toISOString(),
        sha256: expectedHash,
        source: tarballUrl,
      },
      null,
      2,
    ),
  );

  console.log(`✓ Skill "${name}" installed at ${installDir}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(2);
});

async function listTarballEntries(tarballPath: string): Promise<string[]> {
  const output = await runTar(['-tzf', tarballPath], false);
  return output.split('\n').filter(Boolean);
}

async function runTar(args: string[], inherit = true): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn('tar', args, { stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    if (proc.stdout) proc.stdout.on('data', (chunk) => (stdout += String(chunk)));
    if (proc.stderr) proc.stderr.on('data', (chunk) => (stderr += String(chunk)));
    proc.on('exit', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`tar exited ${code}: ${stderr.trim()}`));
    });
    proc.on('error', reject);
  });
}

function assertSafeTarEntry(entry: string): void {
  if (
    entry === '' ||
    entry.startsWith('/') ||
    entry.startsWith('\\') ||
    entry.includes('\0') ||
    entry.includes('\\') ||
    /^[A-Za-z]:/.test(entry)
  ) {
    throw new Error(`Unsafe archive entry path: ${entry}`);
  }
  const parts = entry.split('/');
  if (parts.includes('..')) {
    throw new Error(`Unsafe archive entry path: ${entry}`);
  }
}
