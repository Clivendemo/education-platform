import crypto from 'node:crypto';
import { PassThrough } from 'node:stream';
import { and, eq, sql } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/index.js';
import {
  resourceFiles,
  fileProcessingJobs,
  fileProcessingHistory,
} from '../db/schema/files.js';
import type { StorageProvider } from './storage/storage-provider.interface.js';
import {
  createDefaultMalwareScanner,
  type MalwareScanner,
  type MalwareScanResult,
} from './storage/malware-scanner.js';
import { defaultStorageProvider } from './download.service.js';

export const DEFAULT_FILE_LEASE_DURATION_MS = 90_000; // 90s lease
export const DEFAULT_FILE_HEARTBEAT_INTERVAL_MS = 30_000; // 30s heartbeat
export const DEFAULT_FILE_MAX_WALL_CLOCK_MS = 10 * 60_000; // 10 min hard timeout

const RETRY_BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;

export interface ClaimedFileProcessingJob {
  id: string;
  fileId: string;
  stagedObjectKey: string;
  targetObjectKey: string;
  expectedSha256: string;
  expectedSizeBytes: number;
  cleanVerifiedSha256: string | null;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  fencingToken: number;
}

export interface FileProcessingWorkerOptions {
  db?: AppDatabase;
  storageProvider?: StorageProvider;
  malwareScanner?: MalwareScanner;
  workerId?: string;
  pollIntervalMs?: number;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  maxWallClockMs?: number;
  batchSize?: number;
}

class LeaseFencingLostError extends Error {
  constructor(jobId: string, fencingToken: number) {
    super(
      `LEASE_FENCING_LOST: Worker lost lease ownership for file_processing_job ${jobId} (fencing_token=${fencingToken}).`,
    );
    this.name = 'LeaseFencingLostError';
  }
}

/**
 * Durable Quarantine Scan & Promotion Worker (W1-AC-09).
 *
 * Guarantees:
 * - Claims due `PENDING` or lease-expired `RUNNING` jobs via `FOR UPDATE SKIP LOCKED`, incrementing monotonic `fencing_token`.
 * - Renews `90s` lease every `30s` (`WHERE id = $1 AND status = 'RUNNING' AND locked_by = $2 AND fencing_token = $3`);
 *   if renewal affects `0` rows, triggers `AbortController.abort()` immediately so stale workers never overwrite newer state (`T-W1-LEASE-01`).
 * - Verifies full streaming SHA-256 + byte count on BOTH staged and destination objects (`T-W1-SHA-01`) — never trusts `ETag`.
 * - Recoverable promotion: if a worker crashes after copying `stagedObjectKey` -> `targetObjectKey` (with `clean_verified_sha256` recorded)
 *   before DB commit, the next worker verifies `targetObjectKey` via full streaming SHA-256 + byte size and completes promotion idempotently.
 */
export class FileProcessingWorker {
  private readonly db: AppDatabase;
  private readonly storageProvider: StorageProvider;
  private readonly malwareScanner: MalwareScanner;
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly leaseDurationMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly maxWallClockMs: number;
  private readonly batchSize: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(opts: FileProcessingWorkerOptions = {}) {
    this.db = opts.db ?? defaultDb;
    this.storageProvider = opts.storageProvider ?? defaultStorageProvider;
    this.malwareScanner = opts.malwareScanner ?? createDefaultMalwareScanner();
    this.workerId = opts.workerId ?? `file-worker-${crypto.randomUUID().slice(0, 8)}`;
    this.pollIntervalMs = opts.pollIntervalMs ?? 5_000;
    this.leaseDurationMs = opts.leaseDurationMs ?? DEFAULT_FILE_LEASE_DURATION_MS;
    this.heartbeatIntervalMs =
      opts.heartbeatIntervalMs ?? DEFAULT_FILE_HEARTBEAT_INTERVAL_MS;
    this.maxWallClockMs = opts.maxWallClockMs ?? DEFAULT_FILE_MAX_WALL_CLOCK_MS;
    this.batchSize = opts.batchSize ?? 5;
  }

  public getWorkerId(): string {
    return this.workerId;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(targetFileId?: string): Promise<{ processed: number }> {
    if (this.running) {
      return { processed: 0 };
    }
    this.running = true;
    try {
      const claimed = await this.claimDueJobs(targetFileId);
      let processed = 0;
      for (const job of claimed) {
        await this.processClaimedJob(job);
        processed += 1;
      }
      return { processed };
    } finally {
      this.running = false;
    }
  }

  /**
   * Claims due PENDING jobs or lease-expired RUNNING jobs atomically with monotonic fencing_token increment.
   * Uses PostgreSQL `NOW()` directly so clock skew between app nodes and DB never delays or prematurely expires leases.
   */
  public async claimDueJobs(targetFileId?: string): Promise<ClaimedFileProcessingJob[]> {
    const bucketName = this.storageProvider.getBucketName();
    const providerName = this.storageProvider.getProviderName();
    const fileFilter = targetFileId ? sql`AND j."file_id" = ${targetFileId}` : sql``;

    const result = await this.db.execute(sql`
      WITH due AS (
        SELECT j.id
        FROM "files"."file_processing_jobs" j
        INNER JOIN "files"."resource_files" rf ON rf.id = j."file_id"
        WHERE rf."storage_bucket" = ${bucketName}
          AND rf."storage_provider" = ${providerName}
          AND (
            (j."status" = 'PENDING' AND j."next_run_at" <= NOW())
            OR (j."status" = 'RUNNING' AND j."lease_expires_at" <= NOW())
          )
          ${fileFilter}
        ORDER BY j."next_run_at" ASC, j."created_at" ASC
        LIMIT ${this.batchSize}
        FOR UPDATE OF j SKIP LOCKED
      )
      UPDATE "files"."file_processing_jobs" AS j
      SET
        "status" = 'RUNNING',
        "fencing_token" = j."fencing_token" + 1,
        "locked_by" = ${this.workerId},
        "lease_expires_at" = NOW() + (${this.leaseDurationMs} * interval '1 millisecond'),
        "updated_at" = NOW()
      FROM due
      WHERE j.id = due.id
      RETURNING
        j.id,
        j.file_id AS "fileId",
        j.staged_object_key AS "stagedObjectKey",
        j.target_object_key AS "targetObjectKey",
        j.expected_sha256 AS "expectedSha256",
        j.expected_size_bytes AS "expectedSizeBytes",
        j.clean_verified_sha256 AS "cleanVerifiedSha256",
        j.status,
        j.attempt_count AS "attemptCount",
        j.max_attempts AS "maxAttempts",
        j.fencing_token AS "fencingToken"
    `);

    return (result.rows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      fileId: String(r.fileId),
      stagedObjectKey: String(r.stagedObjectKey),
      targetObjectKey: String(r.targetObjectKey),
      expectedSha256: String(r.expectedSha256).toLowerCase(),
      expectedSizeBytes: Number(r.expectedSizeBytes),
      cleanVerifiedSha256:
        r.cleanVerifiedSha256 !== null && r.cleanVerifiedSha256 !== undefined
          ? String(r.cleanVerifiedSha256).toLowerCase()
          : null,
      status: String(r.status),
      attemptCount: Number(r.attemptCount ?? 0),
      maxAttempts: Number(r.maxAttempts ?? 5),
      fencingToken: Number(r.fencingToken),
    }));
  }

  /**
   * Renews lease strictly when fencing_token and locked_by still match this worker.
   */
  public async renewJobLease(jobId: string, fencingToken: number): Promise<boolean> {
    const updated = await this.db
      .update(fileProcessingJobs)
      .set({
        leaseExpiresAt: sql`NOW() + (${this.leaseDurationMs} * interval '1 millisecond')`,
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(fileProcessingJobs.id, jobId),
          eq(fileProcessingJobs.status, 'RUNNING'),
          eq(fileProcessingJobs.lockedBy, this.workerId),
          eq(fileProcessingJobs.fencingToken, fencingToken),
        ),
      )
      .returning({ id: fileProcessingJobs.id });

    return updated.length > 0;
  }

  public async processClaimedJob(job: ClaimedFileProcessingJob): Promise<void> {
    const abortController = new AbortController();
    const { signal } = abortController;

    const wallClockTimer = setTimeout(() => {
      abortController.abort(new Error('MAX_WALL_CLOCK_EXCEEDED'));
    }, this.maxWallClockMs);
    wallClockTimer.unref?.();

    const heartbeatTimer = setInterval(() => {
      void (async () => {
        try {
          const renewed = await this.renewJobLease(job.id, job.fencingToken);
          if (!renewed && !signal.aborted) {
            abortController.abort(new LeaseFencingLostError(job.id, job.fencingToken));
          }
        } catch {
          // Transient DB hiccup on renewal: if lease actually expires and is stolen, next check or fenced commit catches it
        }
      })();
    }, this.heartbeatIntervalMs);
    heartbeatTimer.unref?.();

    try {
      await this.assertFencingActive(job, signal);

      // 1. Crash-recovery path: previous worker already scanned CLEAN and may have promoted targetObjectKey
      if (
        job.cleanVerifiedSha256 &&
        job.cleanVerifiedSha256 === job.expectedSha256 &&
        (await this.storageProvider.objectExists(job.targetObjectKey))
      ) {
        const targetIntegrity = await this.verifyStoredObjectSha256(
          job.targetObjectKey,
          job.expectedSha256,
          job.expectedSizeBytes,
          signal,
        );

        await this.assertFencingActive(job, signal);

        if (targetIntegrity.valid) {
          await this.finalizePromotedCleanFile(job, 'CRASH_RECOVERY_FINALIZED');
          await this.deleteStagedBestEffort(job.stagedObjectKey);
          return;
        }

        // Target object exists in storage but failed full streaming SHA-256 / byte-size check (e.g. truncated copy).
        // Delete corrupt target object and re-promote from staged quarantine object if available.
        try {
          await this.storageProvider.deleteObject(job.targetObjectKey);
        } catch {
          // Best-effort cleanup before re-promotion
        }
      }

      // 2. Verify staged quarantine object exists before streaming
      const stagedExists = await this.storageProvider.objectExists(job.stagedObjectKey);
      if (!stagedExists) {
        await this.failJobPermanently(
          job,
          'SCAN_ERROR',
          `Staged quarantine object missing (${job.stagedObjectKey}) and no valid promoted target object exists.`,
          'STAGED_OBJECT_MISSING',
        );
        return;
      }

      // 3. Stream staged object through simultaneous SHA-256 + byte counter AND MalwareScanner
      const { scanResult, actualSha256, actualBytes } =
        await this.streamHashAndScanStagedObject(job.stagedObjectKey, job.expectedSizeBytes, signal);

      await this.assertFencingActive(job, signal);

      // Verify staged object integrity before trusting any scan result
      if (
        actualBytes !== job.expectedSizeBytes ||
        actualSha256 !== job.expectedSha256
      ) {
        await this.failJobPermanently(
          job,
          'SCAN_ERROR',
          `Staged object integrity mismatch: expected ${job.expectedSizeBytes} bytes / sha256=${job.expectedSha256}, got ${actualBytes} bytes / sha256=${actualSha256}.`,
          'STAGED_INTEGRITY_MISMATCH',
        );
        await this.deleteStagedBestEffort(job.stagedObjectKey);
        return;
      }

      // 4. Handle INFECTED verdict (terminal quarantine — never retried, never promoted)
      if (scanResult.status === 'INFECTED') {
        await this.quarantineInfectedFile(job, scanResult.signature);
        await this.deleteStagedBestEffort(job.stagedObjectKey);
        return;
      }

      // 5. Handle SCAN_ERROR verdict (bounded exponential retry -> FAILED)
      if (scanResult.status === 'SCAN_ERROR') {
        await this.handleRetryableError(job, scanResult.reason, 'MALWARE_SCAN_ERROR');
        return;
      }

      // 6. Verdict === 'CLEAN': record clean_verified_sha256 guarded by fencing_token BEFORE copying
      await this.recordCleanVerifiedDigest(job);
      await this.assertFencingActive(job, signal);

      // 7. Copy from quarantine/ to canonical resources/ key
      const sourceFile = await this.db
        .select({
          mimeType: resourceFiles.mimeType,
          originalFilename: resourceFiles.originalFilename,
        })
        .from(resourceFiles)
        .where(eq(resourceFiles.id, job.fileId))
        .limit(1);

      const contentType = sourceFile[0]?.mimeType ?? 'application/octet-stream';
      const originalFilename = sourceFile[0]?.originalFilename ?? 'resource';

      await this.storageProvider.copyObject({
        sourceKey: job.stagedObjectKey,
        destinationKey: job.targetObjectKey,
        contentType,
        metadata: {
          'sha256-checksum': job.expectedSha256,
          'original-filename': encodeURIComponent(originalFilename),
        },
      });

      await this.assertFencingActive(job, signal);

      // 8. Full streaming SHA-256 + byte-length verification on promoted destination object (T-W1-SHA-01)
      const promotedCheck = await this.verifyStoredObjectSha256(
        job.targetObjectKey,
        job.expectedSha256,
        job.expectedSizeBytes,
        signal,
      );

      if (!promotedCheck.valid) {
        try {
          await this.storageProvider.deleteObject(job.targetObjectKey);
        } catch {
          // Best-effort cleanup of corrupted destination object
        }
        await this.handleRetryableError(
          job,
          `Promoted destination SHA-256 verification failed: expected ${job.expectedSizeBytes} bytes / ${job.expectedSha256}, got ${promotedCheck.actualBytes} bytes / ${promotedCheck.actualSha256}.`,
          'PROMOTED_SHA256_MISMATCH',
        );
        return;
      }

      await this.assertFencingActive(job, signal);

      // 9. Fenced atomic DB transition: resource_files -> AVAILABLE + CLEAN, job -> COMPLETED
      await this.finalizePromotedCleanFile(job, 'PROMOTED_AVAILABLE');

      // 10. Best-effort deletion of staged quarantine object (7-day R2 lifecycle rule covers crashes here)
      await this.deleteStagedBestEffort(job.stagedObjectKey);
    } catch (err) {
      if (
        err instanceof LeaseFencingLostError ||
        (signal.aborted &&
          signal.reason instanceof LeaseFencingLostError)
      ) {
        // Fencing token was superseded by another worker: halt immediately without touching DB or storage!
        return;
      }

      try {
        await this.handleRetryableError(
          job,
          (err as Error).message || 'Unexpected file processing error',
          'WORKER_EXCEPTION',
        );
      } catch {
        // Ignore if fencing token was lost concurrently
      }
    } finally {
      clearInterval(heartbeatTimer);
      clearTimeout(wallClockTimer);
    }
  }

  private async streamHashAndScanStagedObject(
    key: string,
    expectedSizeBytes: number,
    signal: AbortSignal,
  ): Promise<{
    scanResult: MalwareScanResult;
    actualSha256: string;
    actualBytes: number;
  }> {
    const { stream: sourceStream } = await this.storageProvider.getObjectStream(key, {
      signal,
    });

    const scannerPassThrough = new PassThrough();
    const hash = crypto.createHash('sha256');
    let actualBytes = 0;

    const scanPromise = this.malwareScanner.scanStream(scannerPassThrough, {
      signal,
      expectedSizeBytes,
    });

    const pumpPromise = (async () => {
      try {
        for await (const rawChunk of sourceStream) {
          if (signal.aborted) {
            throw new Error('Aborted while reading staged object');
          }
          const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
          actualBytes += chunk.length;
          hash.update(chunk);

          // If scanner already terminated early (e.g. socket error or early FOUND), drain hash only
          if (!scannerPassThrough.destroyed && scannerPassThrough.writable) {
            const ok = scannerPassThrough.write(chunk);
            if (!ok && !scannerPassThrough.destroyed) {
              await new Promise<void>((resolve) => {
                const onDrainOrClose = () => {
                  scannerPassThrough.off('drain', onDrainOrClose);
                  scannerPassThrough.off('close', onDrainOrClose);
                  scannerPassThrough.off('error', onDrainOrClose);
                  resolve();
                };
                scannerPassThrough.once('drain', onDrainOrClose);
                scannerPassThrough.once('close', onDrainOrClose);
                scannerPassThrough.once('error', onDrainOrClose);
              });
            }
          }
        }
        if (!scannerPassThrough.destroyed) {
          scannerPassThrough.end();
        }
      } catch (err) {
        scannerPassThrough.destroy(err as Error);
        throw err;
      }
    })();

    const [, scanResult] = await Promise.all([pumpPromise, scanPromise]);

    return {
      scanResult,
      actualSha256: hash.digest('hex').toLowerCase(),
      actualBytes,
    };
  }

  /**
   * Streams the stored object in full and computes SHA-256 + byte length.
   * Explicitly ignores storage ETag headers because multipart ETags are non-SHA256 (T-W1-SHA-01).
   */
  public async verifyStoredObjectSha256(
    key: string,
    expectedSha256: string,
    expectedSizeBytes: number,
    signal: AbortSignal,
  ): Promise<{ valid: boolean; actualSha256: string; actualBytes: number }> {
    const { stream } = await this.storageProvider.getObjectStream(key, { signal });
    const hash = crypto.createHash('sha256');
    let actualBytes = 0;

    for await (const rawChunk of stream) {
      if (signal.aborted) {
        throw new Error('Aborted during destination SHA-256 verification');
      }
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      actualBytes += chunk.length;
      hash.update(chunk);
    }

    const actualSha256 = hash.digest('hex').toLowerCase();
    const valid =
      actualBytes === expectedSizeBytes &&
      actualSha256 === expectedSha256.toLowerCase();

    return { valid, actualSha256, actualBytes };
  }

  private async assertFencingActive(
    job: ClaimedFileProcessingJob,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) {
      if (signal.reason instanceof LeaseFencingLostError) {
        throw signal.reason;
      }
      throw new Error(
        signal.reason instanceof Error ? signal.reason.message : 'Job aborted',
      );
    }

    const [current] = await this.db
      .select({
        status: fileProcessingJobs.status,
        lockedBy: fileProcessingJobs.lockedBy,
        fencingToken: fileProcessingJobs.fencingToken,
      })
      .from(fileProcessingJobs)
      .where(eq(fileProcessingJobs.id, job.id))
      .limit(1);

    if (
      !current ||
      current.status !== 'RUNNING' ||
      current.lockedBy !== this.workerId ||
      Number(current.fencingToken) !== job.fencingToken
    ) {
      throw new LeaseFencingLostError(job.id, job.fencingToken);
    }
  }

  private async recordCleanVerifiedDigest(job: ClaimedFileProcessingJob): Promise<void> {
    const now = new Date();
    const updated = await this.db
      .update(fileProcessingJobs)
      .set({
        cleanVerifiedSha256: job.expectedSha256,
        updatedAt: now,
      })
      .where(
        and(
          eq(fileProcessingJobs.id, job.id),
          eq(fileProcessingJobs.status, 'RUNNING'),
          eq(fileProcessingJobs.lockedBy, this.workerId),
          eq(fileProcessingJobs.fencingToken, job.fencingToken),
        ),
      )
      .returning({ id: fileProcessingJobs.id });

    if (updated.length === 0) {
      throw new LeaseFencingLostError(job.id, job.fencingToken);
    }
  }

  private async finalizePromotedCleanFile(
    job: ClaimedFileProcessingJob,
    historyEvent: string,
  ): Promise<void> {
    const now = new Date();

    await this.db.transaction(async (tx) => {
      const lockedJobRes = await tx.execute(sql`
        SELECT id
        FROM "files"."file_processing_jobs"
        WHERE "id" = ${job.id}
          AND "status" = 'RUNNING'
          AND "locked_by" = ${this.workerId}
          AND "fencing_token" = ${job.fencingToken}
        FOR UPDATE
      `);

      if (lockedJobRes.rows.length === 0) {
        throw new LeaseFencingLostError(job.id, job.fencingToken);
      }

      const [existingFile] = await tx
        .select({ storageMetadata: resourceFiles.storageMetadata })
        .from(resourceFiles)
        .where(eq(resourceFiles.id, job.fileId))
        .limit(1);

      const cleanMetadata = {
        ...((existingFile?.storageMetadata as Record<string, unknown>) ?? {}),
        staged: false,
      };

      await tx
        .update(resourceFiles)
        .set({
          objectKey: job.targetObjectKey,
          status: 'AVAILABLE',
          malwareScanStatus: 'CLEAN',
          malwareScanSignature: null,
          scannedAt: now,
          storageMetadata: cleanMetadata,
          updatedAt: now,
        })
        .where(eq(resourceFiles.id, job.fileId));

      await tx
        .update(fileProcessingJobs)
        .set({
          cleanVerifiedSha256: job.expectedSha256,
          status: 'COMPLETED',
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(fileProcessingJobs.id, job.id));

      await tx.insert(fileProcessingHistory).values({
        jobId: job.id,
        fileId: job.fileId,
        eventType: historyEvent,
        fencingToken: job.fencingToken,
        workerId: this.workerId,
        details: {
          targetObjectKey: job.targetObjectKey,
          verifiedSha256: job.expectedSha256,
          verifiedSizeBytes: job.expectedSizeBytes,
        },
      });
    });
  }

  private async quarantineInfectedFile(
    job: ClaimedFileProcessingJob,
    signature: string,
  ): Promise<void> {
    const now = new Date();

    await this.db.transaction(async (tx) => {
      const lockedJobRes = await tx.execute(sql`
        SELECT id
        FROM "files"."file_processing_jobs"
        WHERE "id" = ${job.id}
          AND "status" = 'RUNNING'
          AND "locked_by" = ${this.workerId}
          AND "fencing_token" = ${job.fencingToken}
        FOR UPDATE
      `);

      if (lockedJobRes.rows.length === 0) {
        throw new LeaseFencingLostError(job.id, job.fencingToken);
      }

      await tx
        .update(resourceFiles)
        .set({
          status: 'QUARANTINED',
          malwareScanStatus: 'INFECTED',
          malwareScanSignature: signature.slice(0, 255),
          scannedAt: now,
          updatedAt: now,
        })
        .where(eq(resourceFiles.id, job.fileId));

      await tx
        .update(fileProcessingJobs)
        .set({
          status: 'QUARANTINED',
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: `Malware detected: ${signature}`,
          updatedAt: now,
        })
        .where(eq(fileProcessingJobs.id, job.id));

      await tx.insert(fileProcessingHistory).values({
        jobId: job.id,
        fileId: job.fileId,
        eventType: 'MALWARE_QUARANTINED',
        fencingToken: job.fencingToken,
        workerId: this.workerId,
        details: {
          signature,
          stagedObjectKey: job.stagedObjectKey,
        },
      });
    });
  }

  private async failJobPermanently(
    job: ClaimedFileProcessingJob,
    scanStatus: 'SCAN_ERROR' | 'INFECTED',
    reason: string,
    historyEvent: string,
  ): Promise<void> {
    const now = new Date();

    await this.db.transaction(async (tx) => {
      const lockedJobRes = await tx.execute(sql`
        SELECT id
        FROM "files"."file_processing_jobs"
        WHERE "id" = ${job.id}
          AND "status" = 'RUNNING'
          AND "locked_by" = ${this.workerId}
          AND "fencing_token" = ${job.fencingToken}
        FOR UPDATE
      `);

      if (lockedJobRes.rows.length === 0) {
        throw new LeaseFencingLostError(job.id, job.fencingToken);
      }

      await tx
        .update(resourceFiles)
        .set({
          status: 'FAILED',
          malwareScanStatus: scanStatus,
          updatedAt: now,
        })
        .where(eq(resourceFiles.id, job.fileId));

      await tx
        .update(fileProcessingJobs)
        .set({
          status: 'FAILED',
          attemptCount: job.attemptCount + 1,
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: reason,
          updatedAt: now,
        })
        .where(eq(fileProcessingJobs.id, job.id));

      await tx.insert(fileProcessingHistory).values({
        jobId: job.id,
        fileId: job.fileId,
        eventType: historyEvent,
        fencingToken: job.fencingToken,
        workerId: this.workerId,
        details: { reason },
      });
    });
  }

  private async handleRetryableError(
    job: ClaimedFileProcessingJob,
    reason: string,
    historyEvent: string,
  ): Promise<void> {
    const now = new Date();
    const nextAttemptCount = job.attemptCount + 1;

    if (nextAttemptCount >= job.maxAttempts) {
      await this.failJobPermanently(job, 'SCAN_ERROR', reason, `${historyEvent}_EXHAUSTED`);
      return;
    }

    const backoffMs =
      RETRY_BACKOFF_MS[Math.min(nextAttemptCount - 1, RETRY_BACKOFF_MS.length - 1)];
    const nextRunAt = new Date(now.getTime() + backoffMs);

    await this.db.transaction(async (tx) => {
      const lockedJobRes = await tx.execute(sql`
        SELECT id
        FROM "files"."file_processing_jobs"
        WHERE "id" = ${job.id}
          AND "status" = 'RUNNING'
          AND "locked_by" = ${this.workerId}
          AND "fencing_token" = ${job.fencingToken}
        FOR UPDATE
      `);

      if (lockedJobRes.rows.length === 0) {
        throw new LeaseFencingLostError(job.id, job.fencingToken);
      }

      await tx
        .update(fileProcessingJobs)
        .set({
          status: 'PENDING',
          attemptCount: nextAttemptCount,
          lockedBy: null,
          leaseExpiresAt: null,
          nextRunAt,
          lastError: reason,
          updatedAt: now,
        })
        .where(eq(fileProcessingJobs.id, job.id));

      await tx.insert(fileProcessingHistory).values({
        jobId: job.id,
        fileId: job.fileId,
        eventType: historyEvent,
        fencingToken: job.fencingToken,
        workerId: this.workerId,
        details: {
          attemptCount: nextAttemptCount,
          nextRunAt: nextRunAt.toISOString(),
          reason,
        },
      });
    });
  }

  private async deleteStagedBestEffort(stagedObjectKey: string): Promise<void> {
    try {
      await this.storageProvider.deleteObject(stagedObjectKey);
    } catch {
      // Non-fatal: Cloudflare R2 quarantine/ 7-day lifecycle rule cleans up any orphaned staged objects
    }
  }
}

export const defaultFileProcessingWorker = new FileProcessingWorker();
