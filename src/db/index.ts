import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env.js';
import * as schemas from './schemas.js';

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;
let dbInstance: NodePgDatabase<typeof schemas> | null = null;

/**
 * Returns the singleton pg.Pool instance, initializing it lazily on first access.
 */
export function getDatabasePool(): pg.Pool {
  if (!poolInstance) {
    if (!env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not configured.');
    }

    poolInstance = new Pool({
      connectionString: env.DATABASE_URL,
      min: env.DATABASE_POOL_MIN,
      max: env.DATABASE_POOL_MAX,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });

    // Catch errors on idle clients to prevent unhandled process crashes
    poolInstance.on('error', (err: Error) => {
      // In serverless and cloud-hosted PostgreSQL environments (e.g. Neon, AWS, Cloud SQL),
      // remote proxies and serverless backends routinely reap idle connections.
      // node-postgres automatically discards the terminated client from the pool.
      const isExpectedIdleClosure =
        err.message.includes('Connection terminated unexpectedly') ||
        (err as { code?: string }).code === 'ECONNRESET' ||
        err.message.includes('socket hang up');

      if (!isExpectedIdleClosure) {
        // Unexpected database pool error; log without credential leakage
        console.error('Unexpected error on idle database client:', err.message);
      }
    });
  }

  return poolInstance;
}

/**
 * Returns the Drizzle ORM instance wrapping the pooled database connection.
 */
export function getDb(): NodePgDatabase<typeof schemas> {
  if (!dbInstance) {
    const pool = getDatabasePool();
    dbInstance = drizzle(pool, { schema: schemas });
  }
  return dbInstance;
}

/**
 * Convenience export for Drizzle DB instance using lazy proxy.
 */
export const db = new Proxy({} as NodePgDatabase<typeof schemas>, {
  get(_target, prop) {
    const activeDb = getDb();
    return Reflect.get(activeDb, prop);
  },
});

export interface DatabaseHealthResult {
  status: 'healthy' | 'unhealthy';
  latencyMs?: number;
  error?: string;
}

/**
 * Performs a lightweight health check query (`SELECT 1;`) against PostgreSQL.
 * Ensures connection strings and credentials are never leaked in error messages.
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealthResult> {
  if (!env.DATABASE_URL) {
    return {
      status: 'unhealthy',
      error: 'DATABASE_URL is not configured.',
    };
  }

  const startTime = Date.now();
  try {
    const pool = getDatabasePool();
    const client = await pool.connect();
    try {
      await client.query('SELECT 1;');
      const latencyMs = Date.now() - startTime;
      return { status: 'healthy', latencyMs };
    } finally {
      client.release();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown database connection error';
    // Sanitize any potential URL credentials from the error message
    const sanitizedError = errorMessage.replace(/:\/\/[^@]+@/, '://[REDACTED]@');
    return {
      status: 'unhealthy',
      error: sanitizedError,
    };
  }
}

/**
 * Gracefully shuts down the PostgreSQL connection pool.
 */
export async function closeDatabase(): Promise<void> {
  if (poolInstance) {
    const poolToClose = poolInstance;
    poolInstance = null;
    dbInstance = null;
    await poolToClose.end();
  }
}
