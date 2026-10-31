import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schemas from './schemas.js';
import { ensureCommerceBaseDdl } from './seeds/commerce-setup.js';
import { ensureCalendarBaseDdl } from './seeds/calendar-setup.js';

/**
 * Timestamp boundary for migration 0009_contributor_system (`when: 1791000000000`).
 * Migrations 0000..0009 create `platform`, `content`, `identity`, and `community.contributors`.
 * Migration 0010 (`when: 1791100000000`) references `commerce.orders` and `commerce.order_items`,
 * which historically lived in seed helpers outside `./drizzle`.
 */
export const PRE_COMMERCE_CUTOFF_WHEN = 1791000000000;

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface DrizzleJournal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export interface RunMigrationsOptions {
  migrationsFolder?: string;
}

/**
 * Deterministic 3-step Drizzle migration orchestrator (`W1-AC-01`):
 * 1. Builds an isolated temporary migrations folder containing `0000..0009` and runs standard
 *    Drizzle `migrate()` so `drizzle.__drizzle_migrations` tracks hashes & timestamps identically.
 * 2. Runs structural-DDL-only `ensureCommerceBaseDdl` + `ensureCalendarBaseDdl` (zero reference seeding).
 * 3. Runs standard Drizzle `migrate()` against the full `./drizzle` folder (`0010..0022`).
 */
export async function runPlatformMigrations(
  db: NodePgDatabase<typeof schemas>,
  options: RunMigrationsOptions = {},
): Promise<void> {
  const migrationsFolder = options.migrationsFolder
    ? path.resolve(options.migrationsFolder)
    : path.resolve(process.cwd(), 'drizzle');

  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  const rawJournal = fs.readFileSync(journalPath, 'utf8');
  const journal = JSON.parse(rawJournal) as DrizzleJournal;

  const preEntries = journal.entries.filter((e) => e.when <= PRE_COMMERCE_CUTOFF_WHEN);

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'elimu-drizzle-pre0010-'));
  try {
    const tmpMetaDir = path.join(tmpBase, 'meta');
    fs.mkdirSync(tmpMetaDir, { recursive: true });

    for (const entry of preEntries) {
      const sqlFile = `${entry.tag}.sql`;
      const srcSqlPath = path.join(migrationsFolder, sqlFile);
      const dstSqlPath = path.join(tmpBase, sqlFile);
      fs.copyFileSync(srcSqlPath, dstSqlPath);
    }

    const preJournal: DrizzleJournal = {
      version: journal.version,
      dialect: journal.dialect,
      entries: preEntries,
    };
    fs.writeFileSync(
      path.join(tmpMetaDir, '_journal.json'),
      JSON.stringify(preJournal, null, 2),
      'utf8',
    );

    // Step 1: Apply 0000..0009 via standard Drizzle migrator
    await migrate(db, { migrationsFolder: tmpBase });

    // Step 2: Ensure structural base DDL for commerce & calendar schemas (no reference row seeding)
    await ensureCommerceBaseDdl(db);
    await ensureCalendarBaseDdl(db);

    // Step 3: Apply remaining 0010..0022 migrations via standard Drizzle migrator
    await migrate(db, { migrationsFolder });
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}
