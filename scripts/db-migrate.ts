import { getDb, closeDatabase } from '../src/db/index.js';
import { runPlatformMigrations } from '../src/db/migrate.js';

async function main(): Promise<void> {
  const db = getDb();
  try {
    await runPlatformMigrations(db);
    console.log('Platform database migrations applied successfully (0000..0022).');
  } finally {
    await closeDatabase();
  }
}

main().catch((err) => {
  const baseMsg = err instanceof Error ? err.message : String(err);
  const causeMsg =
    err && typeof err === 'object' && 'cause' in err && (err as { cause?: unknown }).cause instanceof Error
      ? ` | cause: ${((err as { cause: Error }).cause).message}`
      : '';
  console.error(`Database migration failed: ${baseMsg}${causeMsg}`);
  process.exit(1);
});
