import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from '../../../db/index.js';
import * as schemas from '../../../db/schemas.js';
import {
  type CommerceService,
  defaultCommerceService,
} from '../commerce.service.js';

export const MPESA_VERIFICATION_LEASE_MS = 30_000;
export const DEFAULT_MPESA_POLL_INTERVAL_MS = 10_000;

export interface MpesaReconciliationWorkerOptions {
  db?: NodePgDatabase<typeof schemas>;
  commerceService?: CommerceService;
  workerId?: string;
  pollIntervalMs?: number;
  leaseDurationMs?: number;
  batchSize?: number;
}

/**
 * Durable multi-instance M-Pesa reconciliation worker (`W1-AC-06`).
 * - Claims due `commerce.payments` rows (`status IN ('PENDING', 'PROCESSING')`, `next_verification_at <= now`)
 *   via `FOR UPDATE SKIP LOCKED` with a `30s` short lease (`verification_locked_at` / `verification_locked_by`).
 * - Releases DB transaction BEFORE executing network Daraja `stkpushquery` calls.
 * - Escalates exhausted uncertain/unrecognized queries after 10 attempts to `RECONCILIATION_REQUIRED`.
 */
export class MpesaReconciliationWorker {
  private readonly db: NodePgDatabase<typeof schemas>;
  private readonly commerceService: CommerceService;
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly leaseDurationMs: number;
  private readonly batchSize: number;

  private timer: NodeJS.Timeout | null = null;
  private isSweeping = false;

  constructor(options: MpesaReconciliationWorkerOptions = {}) {
    this.db = options.db ?? defaultDb;
    this.commerceService = options.commerceService ?? defaultCommerceService;
    this.workerId = options.workerId ?? `mpesa-reconciler-${crypto.randomUUID().slice(0, 8)}`;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_MPESA_POLL_INTERVAL_MS;
    this.leaseDurationMs = options.leaseDurationMs ?? MPESA_VERIFICATION_LEASE_MS;
    this.batchSize = options.batchSize ?? 10;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => {
        // Individual sweep errors are isolated so background polling stays alive
      });
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Claims and processes one batch of due M-Pesa payments.
   * Safe to invoke directly in deterministic integration tests.
   */
  async runOnce(now: Date = new Date()): Promise<{
    claimed: number;
    processed: Array<{ paymentId: string; status: string; entitlementsGranted: number }>;
  }> {
    if (this.isSweeping) {
      return { claimed: 0, processed: [] };
    }
    this.isSweeping = true;

    try {
      const staleLeaseCutoff = new Date(now.getTime() - this.leaseDurationMs);

      const claimedIds = await this.db.transaction(async (tx) => {
        const claimResult = await tx.execute(sql`
          WITH due_candidates AS (
            SELECT "id"
            FROM "commerce"."payments"
            WHERE "provider_code" = 'MPESA'
              AND "status" IN ('PENDING', 'PROCESSING')
              AND "next_verification_at" IS NOT NULL
              AND "next_verification_at" <= ${now}
              AND (
                "verification_locked_at" IS NULL
                OR "verification_locked_at" <= ${staleLeaseCutoff}
              )
            ORDER BY "next_verification_at" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT ${this.batchSize}
          )
          UPDATE "commerce"."payments" AS p
          SET
            "verification_locked_at" = ${now},
            "verification_locked_by" = ${this.workerId},
            "updated_at" = ${now}
          FROM due_candidates
          WHERE p."id" = due_candidates."id"
          RETURNING p."id"
        `);

        return (claimResult.rows as Array<{ id: string }>).map((r) => r.id);
      });

      const processed: Array<{
        paymentId: string;
        status: string;
        entitlementsGranted: number;
      }> = [];

      for (const paymentId of claimedIds) {
        const res = await this.commerceService.reconcileMpesaPaymentById(
          paymentId,
          this.workerId,
        );
        if (res) {
          processed.push(res);
        }
      }

      return {
        claimed: claimedIds.length,
        processed,
      };
    } finally {
      this.isSweeping = false;
    }
  }
}

export const defaultMpesaReconciliationWorker = new MpesaReconciliationWorker();
