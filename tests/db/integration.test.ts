import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDatabasePool, closeDatabase, checkDatabaseHealth } from '../../src/db/index.js';

const isCI = process.env.CI === 'true';
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe('PostgreSQL Database Integration Tests', () => {
  // In CI, database integration tests are mandatory
  if (isCI && !hasDatabaseUrl) {
    it('requires DATABASE_URL in CI environment', () => {
      throw new Error('Mandatory CI test failed: DATABASE_URL must be provided in CI environment.');
    });
    return;
  }

  // In local development, skip if DATABASE_URL is not set
  if (!hasDatabaseUrl) {
    it.skip('skipping database integration tests: DATABASE_URL is not set in local environment', () => {});
    return;
  }

  beforeAll(async () => {
    const health = await checkDatabaseHealth();
    if (health.status !== 'healthy') {
      throw new Error(`Database connection failed: ${health.error}`);
    }
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('connects to PostgreSQL and executes a basic query', async () => {
    const pool = getDatabasePool();
    const result = await pool.query('SELECT 1 as connected;');
    expect(result.rows[0].connected).toBe(1);
  });

  it('verifies that the pgcrypto extension is installed', async () => {
    const pool = getDatabasePool();
    const result = await pool.query(
      "SELECT extname FROM pg_extension WHERE extname = 'pgcrypto';"
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0].extname).toBe('pgcrypto');
  });

  it('verifies that gen_random_uuid() generates valid UUIDs', async () => {
    const pool = getDatabasePool();
    const result = await pool.query('SELECT gen_random_uuid() as uuid;');
    expect(result.rows[0].uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('verifies that all 11 logical PostgreSQL schemas exist', async () => {
    const pool = getDatabasePool();
    const expectedSchemas = [
      'platform',
      'taxonomy',
      'content',
      'files',
      'commerce',
      'identity',
      'community',
      'calendar',
      'analytics',
      'governance',
      'system',
    ];

    const result = await pool.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1);",
      [expectedSchemas]
    );

    const foundSchemas = result.rows.map((r: { schema_name: string }) => r.schema_name);
    for (const schema of expectedSchemas) {
      expect(foundSchemas).toContain(schema);
    }
  });
});
