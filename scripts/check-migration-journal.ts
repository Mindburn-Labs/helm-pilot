#!/usr/bin/env tsx
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

const migrationsDir = join(process.cwd(), 'packages/db/migrations');
const journalPath = join(migrationsDir, 'meta/_journal.json');

const sqlTags = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .map((file) => file.replace(/\.sql$/u, ''))
  .sort();

const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
const journalTags = journal.entries.map((entry) => entry.tag);

const missing = sqlTags.filter((tag) => !journalTags.includes(tag));
const extra = journalTags.filter((tag) => !sqlTags.includes(tag));
const duplicates = journalTags.filter((tag, index) => journalTags.indexOf(tag) !== index);
const orderMismatch =
  sqlTags.length === journalTags.length && sqlTags.some((tag, index) => journalTags[index] !== tag);
const idxMismatch = journal.entries.filter((entry, index) => entry.idx !== index);

if (
  missing.length > 0 ||
  extra.length > 0 ||
  duplicates.length > 0 ||
  orderMismatch ||
  idxMismatch.length > 0
) {
  if (missing.length > 0) console.error(`Missing from migration journal: ${missing.join(', ')}`);
  if (extra.length > 0) console.error(`Journal entries without SQL files: ${extra.join(', ')}`);
  if (duplicates.length > 0) console.error(`Duplicate journal entries: ${duplicates.join(', ')}`);
  if (orderMismatch) console.error('Migration journal order does not match SQL filename order.');
  if (idxMismatch.length > 0) {
    console.error(`Journal idx mismatch: ${idxMismatch.map((entry) => entry.tag).join(', ')}`);
  }
  process.exit(1);
}

console.log(`Migration journal covers ${sqlTags.length} SQL migrations.`);
