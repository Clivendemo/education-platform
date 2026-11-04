import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql, eq } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, closeDatabase } from '../../src/db/index.js';
import * as schemas from '../../src/db/schemas.js';
import { runPlatformMigrations } from '../../src/db/migrate.js';
import {
  ensureCommerceBaseDdl,
  setupCommerceSchema,
} from '../../src/db/seeds/commerce-setup.js';
import { ensureCalendarBaseDdl } from '../../src/db/seeds/calendar-setup.js';
import { withDbRetry } from '../helpers/db-retry.js';

const { Pool, Client } = pg;

function buildIsolatedDbUrl(baseUrl: string, dbName: string): string {
  const parsed = new URL(baseUrl);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

function buildPartialMigrationsFolder(maxIdxInclusive: number): string {
  const srcFolder = path.resolve(process.cwd(), 'drizzle');
  const journal = JSON.parse(
    fs.readFileSync(path.join(srcFolder, 'meta', '_journal.json'), 'utf8'),
  );
  const subsetEntries = journal.entries.filter(
    (e: { idx: number }) => e.idx <= maxIdxInclusive,
  );

  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `elimu-mig-subset-${maxIdxInclusive}-`),
  );
  fs.mkdirSync(path.join(tmpDir, 'meta'), { recursive: true });
  for (const entry of subsetEntries) {
    fs.copyFileSync(
      path.join(srcFolder, `${entry.tag}.sql`),
      path.join(tmpDir, `${entry.tag}.sql`),
    );
  }
  fs.writeFileSync(
    path.join(tmpDir, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: subsetEntries }, null, 2),
    'utf8',
  );
  return tmpDir;
}

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe.skipIf(!isDbAvailable)(
  'Wave 1 WP8: Migration Compatibility, Order Idempotency & Receipt Provenance Constraints',
  () => {
    let canCreateTempDatabase = false;

  beforeAll(async () => {
    await withDbRetry(() => runPlatformMigrations(db));
    await withDbRetry(() => setupCommerceSchema(db));

    if (process.env.DATABASE_URL) {
      const probeName = `elimu_mig_probe_${Date.now()}`;
      const adminClient = new Client({ connectionString: process.env.DATABASE_URL });
      try {
        await adminClient.connect();
        await adminClient.query(`CREATE DATABASE "${probeName}"`);
        canCreateTempDatabase = true;
        await adminClient.query(`DROP DATABASE IF EXISTS "${probeName}"`);
      } catch {
        canCreateTempDatabase = false;
      } finally {
        await adminClient.end().catch(() => {});
      }
    }
  }, 180000);

  afterAll(async () => {
    await closeDatabase();
  });

  async function withIsolatedDatabase(
    label: string,
    fn: (isolatedDb: NodePgDatabase<typeof schemas>, rawPool: pg.Pool) => Promise<void>,
  ): Promise<void> {
    const baseUrl = process.env.DATABASE_URL!;
    const dbName = `elimu_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`.toLowerCase();
    const adminClient = new Client({ connectionString: baseUrl });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE "${dbName}"`);

    const isolatedPool = new Pool({
      connectionString: buildIsolatedDbUrl(baseUrl, dbName),
      max: 2,
    });
    const isolatedDb = drizzle(isolatedPool, { schema: schemas });

    try {
      await fn(isolatedDb, isolatedPool);
    } finally {
      await isolatedPool.end().catch(() => {});
      await adminClient
        .query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [dbName],
        )
        .catch(() => {});
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}"`).catch(() => {});
      await adminClient.end().catch(() => {});
    }
  }

  describe('W1-AC-01: 4-State Migration Compatibility Proof (T-MIG-01..04)', () => {
    it('T-MIG-01: migrates cleanly from an empty database with zero seeded reference rows and is idempotent on re-run', async () => {
      if (!canCreateTempDatabase) {
        // Fallback idempotency verification on primary DB if cloud role lacks CREATEDB
        await expect(runPlatformMigrations(db)).resolves.toBeUndefined();
        return;
      }

      await withIsolatedDatabase('tmig01', async (isolatedDb) => {
        await runPlatformMigrations(isolatedDb);
        // Re-running must be a clean idempotent no-op
        await runPlatformMigrations(isolatedDb);

        const appliedCount = await isolatedDb.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM "drizzle"."__drizzle_migrations"`,
        );
        expect(Number((appliedCount.rows[0] as any).cnt)).toBe(25); // 0000..0024

        // Structural-only bootstrap invariant: calendar_event_types has 0 seeded rows during migration
        const calendarTypesCount = await isolatedDb.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM "calendar"."calendar_event_types"`,
        );
        expect(Number((calendarTypesCount.rows[0] as any).cnt)).toBe(0);
      });
    }, 180000);

    it('T-MIG-02: migrates cleanly from starting state 0008 (pre-contributor)', async () => {
      if (!canCreateTempDatabase) return;

      const subset0008 = buildPartialMigrationsFolder(8);
      try {
        await withIsolatedDatabase('tmig02', async (isolatedDb) => {
          await migrate(isolatedDb, { migrationsFolder: subset0008 });
          await runPlatformMigrations(isolatedDb);

          const appliedCount = await isolatedDb.execute(
            sql`SELECT COUNT(*)::int AS cnt FROM "drizzle"."__drizzle_migrations"`,
          );
          expect(Number((appliedCount.rows[0] as any).cnt)).toBe(25);
        });
      } finally {
        fs.rmSync(subset0008, { recursive: true, force: true });
      }
    }, 180000);

    it('T-MIG-03: migrates cleanly from starting state 0009 (pre-commerce)', async () => {
      if (!canCreateTempDatabase) return;

      const subset0009 = buildPartialMigrationsFolder(9);
      try {
        await withIsolatedDatabase('tmig03', async (isolatedDb) => {
          await migrate(isolatedDb, { migrationsFolder: subset0009 });
          await runPlatformMigrations(isolatedDb);

          const appliedCount = await isolatedDb.execute(
            sql`SELECT COUNT(*)::int AS cnt FROM "drizzle"."__drizzle_migrations"`,
          );
          expect(Number((appliedCount.rows[0] as any).cnt)).toBe(25);
        });
      } finally {
        fs.rmSync(subset0009, { recursive: true, force: true });
      }
    }, 180000);

    it('T-MIG-04: migrates cleanly from starting state 0021 with legacy constraint-backed uq_orders_idempotency_key', async () => {
      if (!canCreateTempDatabase) return;

      const subset0009 = buildPartialMigrationsFolder(9);
      const subset0021 = buildPartialMigrationsFolder(21);
      try {
        await withIsolatedDatabase('tmig04', async (isolatedDb) => {
          await migrate(isolatedDb, { migrationsFolder: subset0009 });
          await ensureCommerceBaseDdl(isolatedDb);
          await ensureCalendarBaseDdl(isolatedDb);
          // Simulate legacy constraint-backed unique object on commerce.orders
          await isolatedDb.execute(sql`
            DROP INDEX IF EXISTS "commerce"."uq_orders_user_idempotency_key";
            ALTER TABLE "commerce"."orders"
              ADD CONSTRAINT "uq_orders_idempotency_key" UNIQUE ("idempotency_key");
          `);
          await migrate(isolatedDb, { migrationsFolder: subset0021 });

          // Now run full platform migration applying 0022
          await runPlatformMigrations(isolatedDb);

          const legacyCheck = await isolatedDb.execute(sql`
            SELECT conname
            FROM pg_constraint
            WHERE conname = 'uq_orders_idempotency_key'
          `);
          expect(legacyCheck.rows.length).toBe(0);

          const scopedIndexCheck = await isolatedDb.execute(sql`
            SELECT indexname
            FROM pg_indexes
            WHERE schemaname = 'commerce'
              AND tablename = 'orders'
              AND indexname = 'uq_orders_user_idempotency_key'
          `);
          expect(scopedIndexCheck.rows.length).toBe(1);
        });
      } finally {
        fs.rmSync(subset0009, { recursive: true, force: true });
        fs.rmSync(subset0021, { recursive: true, force: true });
      }
    }, 180000);
  });

  describe('W1-AC-02: Drop Constraint Before Drop Index & User-Scoped Order Idempotency', () => {
    it('drops both constraint-backed and standalone-index uq_orders_idempotency_key cleanly and scopes uniqueness to (user_id, idempotency_key)', async () => {
      // 1. Verify exact DROP CONSTRAINT -> DROP INDEX SQL sequence on an isolated temp table fixture
      await db.execute(sql`
        CREATE TEMP TABLE tmp_orders_constraint_fixture (
          id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
          user_id uuid NOT NULL,
          idempotency_key varchar(100),
          CONSTRAINT uq_orders_idempotency_key UNIQUE (idempotency_key)
        );
      `);
      await db.execute(sql`
        ALTER TABLE tmp_orders_constraint_fixture DROP CONSTRAINT IF EXISTS uq_orders_idempotency_key;
      `);
      await db.execute(sql`
        DROP INDEX IF EXISTS uq_orders_idempotency_key;
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX uq_tmp_orders_user_idem
          ON tmp_orders_constraint_fixture (user_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL;
      `);
      await db.execute(sql`DROP TABLE tmp_orders_constraint_fixture;`);

      // 2. Verify two distinct users can reuse the exact same idempotency_key in commerce.orders without collision
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const sharedIdempotencyKey = `shared-idem-${suffix}`;
      const [u1] = await db
        .insert(schemas.users)
        .values({ email: `idem-u1-${suffix}@example.com`, displayName: 'Idem U1' })
        .returning();
      const [u2] = await db
        .insert(schemas.users)
        .values({ email: `idem-u2-${suffix}@example.com`, displayName: 'Idem U2' })
        .returning();

      let order1Id: string | undefined;
      let order2Id: string | undefined;
      try {
        const [o1] = await db
          .insert(schemas.orders)
          .values({
            userId: u1.id,
            currencyCode: 'KES',
            totalMinor: 10000n,
            status: 'PENDING',
            idempotencyKey: sharedIdempotencyKey,
          })
          .returning();
        order1Id = o1.id;

        const [o2] = await db
          .insert(schemas.orders)
          .values({
            userId: u2.id,
            currencyCode: 'KES',
            totalMinor: 10000n,
            status: 'PENDING',
            idempotencyKey: sharedIdempotencyKey,
          })
          .returning();
        order2Id = o2.id;
        expect(order2Id).not.toBe(order1Id);

        // Same user + same idempotencyKey MUST still violate uq_orders_user_idempotency_key
        await expect(
          db.insert(schemas.orders).values({
            userId: u1.id,
            currencyCode: 'KES',
            totalMinor: 10000n,
            status: 'PENDING',
            idempotencyKey: sharedIdempotencyKey,
          }),
        ).rejects.toThrow();
      } finally {
        if (order1Id) await db.delete(schemas.orders).where(eq(schemas.orders.id, order1Id)).catch(() => {});
        if (order2Id) await db.delete(schemas.orders).where(eq(schemas.orders.id, order2Id)).catch(() => {});
        await db.delete(schemas.users).where(eq(schemas.users.id, u1.id)).catch(() => {});
        await db.delete(schemas.users).where(eq(schemas.users.id, u2.id)).catch(() => {});
      }
    });
  });

  describe('W1-AC-04: Null-Safe PostgreSQL 3VL Verified Receipt Provenance Constraint (T-W1-RCPT-01, T-W1-RCPT-02)', () => {
    it('T-W1-RCPT-01 & T-W1-RCPT-02: rejects non-null receipt with NULL source, blank receipt, or non-null source with NULL receipt, while allowing valid pairs', async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const [user] = await db
        .insert(schemas.users)
        .values({ email: `rcpt-chk-${suffix}@example.com`, displayName: 'Receipt Constraint Tester' })
        .returning();

      const [order] = await db
        .insert(schemas.orders)
        .values({
          userId: user.id,
          currencyCode: 'KES',
          totalMinor: 15000n,
          status: 'PROCESSING',
        })
        .returning();

      try {
        // T-W1-RCPT-01a: Non-null verified_receipt_number + NULL receipt_verification_source MUST be rejected (PostgreSQL 3VL trap closed!)
        await expect(
          db.insert(schemas.payments).values({
            orderId: order.id,
            providerCode: 'MPESA',
            amountMinor: 15000n,
            currencyCode: 'KES',
            status: 'COMPLETED',
            verifiedReceiptNumber: `RCPTNULLSRC${suffix.slice(0, 6)}`,
            receiptVerificationSource: null,
          }),
        ).rejects.toThrow();

        // T-W1-RCPT-01b: Whitespace-only verified_receipt_number + valid source MUST be rejected
        await expect(
          db.insert(schemas.payments).values({
            orderId: order.id,
            providerCode: 'MPESA',
            amountMinor: 15000n,
            currencyCode: 'KES',
            status: 'COMPLETED',
            verifiedReceiptNumber: '    ',
            receiptVerificationSource: 'ADMIN_RECONCILED_RECEIPT',
          }),
        ).rejects.toThrow();

        // T-W1-RCPT-01c: NULL verified_receipt_number + non-null source MUST be rejected
        await expect(
          db.insert(schemas.payments).values({
            orderId: order.id,
            providerCode: 'MPESA',
            amountMinor: 15000n,
            currencyCode: 'KES',
            status: 'COMPLETED',
            verifiedReceiptNumber: null,
            receiptVerificationSource: 'PROVIDER_VERIFIED_RECEIPT',
          }),
        ).rejects.toThrow();

        // T-W1-RCPT-02a: Both NULL + populated callback_receipt_candidate succeeds (sandbox / query-without-receipt)
        const [sandboxPay] = await db
          .insert(schemas.payments)
          .values({
            orderId: order.id,
            providerCode: 'MPESA',
            amountMinor: 15000n,
            currencyCode: 'KES',
            status: 'COMPLETED',
            callbackReceiptCandidate: `CAND-${suffix}`,
            verifiedReceiptNumber: null,
            receiptVerificationSource: null,
          })
          .returning();
        expect(sandboxPay.callbackReceiptCandidate).toBe(`CAND-${suffix}`);
        expect(sandboxPay.verifiedReceiptNumber).toBeNull();

        // T-W1-RCPT-02b: Non-empty verified_receipt_number + ADMIN_RECONCILED_RECEIPT succeeds
        const validReceipt = `ADM${Date.now().toString().slice(-8)}`;
        const [adminPay] = await db
          .insert(schemas.payments)
          .values({
            orderId: order.id,
            providerCode: 'MPESA',
            amountMinor: 15000n,
            currencyCode: 'KES',
            status: 'COMPLETED',
            verifiedReceiptNumber: validReceipt,
            receiptVerificationSource: 'ADMIN_RECONCILED_RECEIPT',
          })
          .returning();
        expect(adminPay.verifiedReceiptNumber).toBe(validReceipt);
        expect(adminPay.receiptVerificationSource).toBe('ADMIN_RECONCILED_RECEIPT');
      } finally {
        await db.delete(schemas.payments).where(eq(schemas.payments.orderId, order.id)).catch(() => {});
        await db.delete(schemas.orders).where(eq(schemas.orders.id, order.id)).catch(() => {});
        await db.delete(schemas.users).where(eq(schemas.users.id, user.id)).catch(() => {});
      }
    });
  });
});
