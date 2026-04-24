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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

async function main() {
  const name = process.argv[2];
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(
      'Usage: install-skill <skill-name>  (lowercase letters, digits, hyphens only)',
    );
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
    console.error(
      `Manifest does not contain a valid SHA-256 hex digest: "${expectedHash}"`,
    );
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
    console.error(
      `SHA-256 mismatch. Expected ${expectedHash}, got ${actualHash}`,
    );
    process.exit(1);
  }
  console.log(`Integrity verified (${buffer.byteLength} bytes).`);

  // 3. Extract into install dir via system tar (avoids npm tar dep).
  const installDir = join(homedir(), '.helm-pilot', 'skills', name);
  if (!existsSync(installDir)) mkdirSync(installDir, { recursive: true });
  const tmpTarball = join(tmpdir(), `helm-skill-${name}-${Date.now()}.tar.gz`);
  writeFileSync(tmpTarball, buffer);

  console.log(`Extracting to: ${installDir}`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('tar', ['-xzf', tmpTarball, '-C', installDir], {
      stdio: 'inherit',
    });
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited ${code}`));
    });
    proc.on('error', reject);
  });

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
