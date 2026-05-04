#!/usr/bin/env node
/**
 * License audit — Phase 13 Track E
 *
 * Walks node_modules, reads every transitive dependency's declared
 * license, and fails the build if any fall outside the allowlist.
 *
 * Designed to run without adding a new runtime dep: uses only node:fs
 * + node:path, reads package.json directly. Supports SPDX expressions
 * like "(MIT OR Apache-2.0)" by splitting on OR/AND and testing each.
 *
 * Usage:  npx tsx scripts/check-licenses.ts
 *         npx tsx scripts/check-licenses.ts --json license-report.json
 *         npx tsx scripts/check-licenses.ts --allow-unknown
 */

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ─── Allowlist ───
// Permissive OSS licenses the project accepts by policy. Keep in sync with
// CONTRIBUTING.md / docs/self-hosting.md when adding.
const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'Apache 2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'ISC',
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-3.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'Python-2.0',
  'WTFPL',
  'Zlib',
  'MPL-2.0', // copyleft but file-scope; acceptable
]);

// Private monorepo workspaces typically declare license: UNLICENSED.
// That's fine for packages we own.
const PRIVATE_MARKERS = new Set(['UNLICENSED', 'SEE LICENSE IN LICENSE', 'PROPRIETARY']);

// Next.js pulls Sharp/libvips as an optional image-optimization dependency even
// when apps do not use next/image. Pilot disables image optimization and
// prunes these binaries from the production web image.
function isExcludedOptionalBinaryPackage(name: string): boolean {
  return name.startsWith('@img/sharp-libvips-');
}

interface Finding {
  name: string;
  version: string;
  license: string;
  path: string;
  verdict: 'allowed' | 'denied' | 'unknown';
}

const args = process.argv.slice(2);
const jsonOut = (() => {
  const i = args.indexOf('--json');
  return i >= 0 ? args[i + 1] : undefined;
})();
const allowUnknown = args.includes('--allow-unknown');

function findWorkspaceRoots(repoRoot: string): string[] {
  const pkgPath = join(repoRoot, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { workspaces?: string[] };
  const globs = pkg.workspaces ?? [];
  const roots: string[] = [repoRoot];
  for (const glob of globs) {
    // Simple handling: only expand a trailing /*
    if (glob.endsWith('/*')) {
      const dir = join(repoRoot, glob.slice(0, -2));
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) roots.push(full);
      }
    } else {
      roots.push(join(repoRoot, glob));
    }
  }
  return roots;
}

function walkNodeModules(nmDir: string, out: Finding[]): void {
  if (!existsSync(nmDir)) return;
  for (const entry of readdirSync(nmDir)) {
    if (entry === '.bin' || entry === '.cache' || entry === '.package-lock.json') continue;
    const full = join(nmDir, entry);
    if (entry.startsWith('@')) {
      // Scoped packages.
      for (const sub of readdirSync(full)) {
        checkPackage(join(full, sub), out);
      }
    } else {
      checkPackage(full, out);
    }
  }
}

function checkPackage(pkgDir: string, out: Finding[]): void {
  const pkgJson = join(pkgDir, 'package.json');
  if (!existsSync(pkgJson)) return;
  try {
    const pkg = JSON.parse(readFileSync(pkgJson, 'utf8')) as {
      name?: string;
      version?: string;
      license?: string | { type?: string };
      licenses?: Array<{ type?: string }>;
      private?: boolean;
    };

    const name = pkg.name ?? '(unknown)';
    const version = pkg.version ?? '0.0.0';
    const license = normalizeLicense(pkg);

    if (isExcludedOptionalBinaryPackage(name)) {
      return;
    }

    // Allow our own private workspace packages without license field.
    if (pkg.private && (!license || PRIVATE_MARKERS.has(license.toUpperCase()))) {
      out.push({
        name,
        version,
        license: license ?? 'UNLICENSED (private)',
        path: pkgDir,
        verdict: 'allowed',
      });
      return;
    }

    if (!license) {
      out.push({ name, version, license: '(missing)', path: pkgDir, verdict: 'unknown' });
      return;
    }

    out.push({ name, version, license, path: pkgDir, verdict: classify(license) });

    // Recurse into nested node_modules (hoisting fallback).
    walkNodeModules(join(pkgDir, 'node_modules'), out);
  } catch {
    // Malformed package.json — skip silently; license-checker treats as unknown.
  }
}

function normalizeLicense(pkg: {
  license?: string | { type?: string };
  licenses?: Array<{ type?: string }>;
}): string | null {
  if (typeof pkg.license === 'string') return pkg.license.trim();
  if (pkg.license && typeof pkg.license === 'object' && pkg.license.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
    return pkg.licenses
      .map((l) => l.type)
      .filter((t): t is string => Boolean(t))
      .join(' OR ');
  }
  return null;
}

function classify(license: string): 'allowed' | 'denied' | 'unknown' {
  const trimmed = license.trim();
  if (!trimmed) return 'unknown';
  if (PRIVATE_MARKERS.has(trimmed.toUpperCase())) return 'unknown';

  // Handle SPDX OR/AND expressions — if any branch is allowed, accept it.
  // Strip parens for simple parsing.
  const clean = trimmed.replace(/[()]/g, '');
  const orParts = clean.split(/\s+OR\s+/i);
  for (const part of orParts) {
    const andParts = part.split(/\s+AND\s+/i).map((s) => s.trim());
    if (andParts.every((p) => ALLOWED.has(p))) return 'allowed';
  }
  return 'denied';
}

function main(): void {
  const repoRoot = resolve(process.cwd());
  const roots = findWorkspaceRoots(repoRoot);
  const findings: Finding[] = [];

  for (const root of roots) {
    walkNodeModules(join(root, 'node_modules'), findings);
  }

  // Dedup on (name, version) pair.
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const key = `${f.name}@${f.version}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const denied = unique.filter((f) => f.verdict === 'denied');
  const unknown = unique.filter((f) => f.verdict === 'unknown');

  console.log(`License audit: ${unique.length} unique packages scanned`);
  console.log(`  allowed : ${unique.filter((f) => f.verdict === 'allowed').length}`);
  console.log(`  denied  : ${denied.length}`);
  console.log(`  unknown : ${unknown.length}`);

  if (denied.length > 0) {
    console.error('\nDenied packages (non-allowlisted license):');
    for (const f of denied) {
      console.error(`  - ${f.name}@${f.version} — ${f.license}`);
    }
  }
  if (unknown.length > 0 && !allowUnknown) {
    console.error('\nPackages with missing/unknown license:');
    for (const f of unknown) {
      console.error(`  - ${f.name}@${f.version} — ${f.license} (${f.path})`);
    }
  }

  if (jsonOut) {
    writeFileSync(resolve(jsonOut), JSON.stringify(unique, null, 2));
    console.log(`\nReport written to ${jsonOut}`);
  }

  if (denied.length > 0 || (unknown.length > 0 && !allowUnknown)) {
    process.exit(1);
  }
  console.log('\n✓ License audit passed');
}

main();
