import net from 'node:net';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import type { Readable } from 'node:stream';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { getDb, closeDatabase } from '../../src/db/index.js';
import {
  countries,
  resourceTypes,
  resources,
  resourceVersions,
  resourceFiles,
  fileProcessingJobs,
  publicationEvents,
  users,
} from '../../src/db/schemas.js';
import { buildApp } from '../../src/app.js';
import { FileStorageService } from '../../src/services/file-storage.service.js';
import { FileProcessingWorker } from '../../src/services/file-processing.worker.js';
import {
  ClamdMalwareScanner,
  StubCleanMalwareScanner,
  type MalwareScanner,
  type MalwareScanOptions,
  type MalwareScanResult,
} from '../../src/services/storage/malware-scanner.js';
import { MemoryStorageProvider } from '../../src/services/storage/memory-storage-provider.js';
import { DbPublicationService } from '../../src/services/publication.service.js';
import { DefaultDownloadService } from '../../src/services/download.service.js';
import { DefaultAuthService, SESSION_COOKIE_NAME } from '../../src/services/auth.service.js';
import { runPlatformMigrations } from '../../src/db/migrate.js';
import { withDbRetry } from '../helpers/db-retry.js';

/**
 * Helper to construct a minimal valid uncompressed/deflate ZIP archive in memory
 * so we can test OOXML validation, Zip-Slip traversal rejection, and compression-ratio bombs deterministically.
 */
function buildTestZipBuffer(
  entries: Array<{
    name: string;
    content: Buffer;
    deflate?: boolean;
  }>,
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const uncompressedSize = entry.content.length;
    const method = entry.deflate ? 8 : 0;
    const compressedPayload = entry.deflate
      ? zlib.deflateRawSync(entry.content)
      : entry.content;
    const compressedSize = compressedPayload.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // gp bit flag
    localHeader.writeUInt16LE(method, 8); // compression method
    localHeader.writeUInt32LE(0, 14); // crc32 (0 sufficient for header inspection)
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len

    const localRecord = Buffer.concat([localHeader, nameBytes, compressedPayload]);
    localParts.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central dir sig
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // gp bit flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(0, 16); // crc32
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra len
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt32LE(localOffset, 42); // relative offset

    centralParts.push(Buffer.concat([centralHeader, nameBytes]));
    localOffset += localRecord.length;
  }

  const centralDirBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuffer.length, 12);
  eocd.writeUInt32LE(localOffset, 16);

  return Buffer.concat([...localParts, centralDirBuffer, eocd]);
}

/**
 * Starts a local TCP server speaking ClamAV's `zINSTREAM` binary protocol.
 */
async function startMockClamdServer(
  handler: (receivedPayload: Buffer) => string,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer((socket) => {
    const rawBufs: Buffer[] = [];
    let totalLen = 0;

    socket.on('data', (chunk: Buffer) => {
      rawBufs.push(chunk);
      totalLen += chunk.length;
      const combined = Buffer.concat(rawBufs, totalLen);

      // Expect leading "zINSTREAM\0" (10 bytes)
      if (combined.length < 10) return;
      const prefix = combined.subarray(0, 10).toString('ascii');
      if (prefix !== 'zINSTREAM\0') {
        socket.end('UNKNOWN COMMAND\0');
        return;
      }

      // Parse [4-byte BE length][chunk]... until 0x00000000
      let offset = 10;
      const payloadParts: Buffer[] = [];
      while (offset + 4 <= combined.length) {
        const chunkLen = combined.readUInt32BE(offset);
        offset += 4;
        if (chunkLen === 0) {
          const fullPayload = Buffer.concat(payloadParts);
          const reply = handler(fullPayload);
          socket.end(`${reply}\0`);
          return;
        }
        if (offset + chunkLen > combined.length) {
          // Wait for remaining chunk bytes
          return;
        }
        payloadParts.push(combined.subarray(offset, offset + chunkLen));
        offset += chunkLen;
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as net.AddressInfo;

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe('Wave 1 WP6: Upload Quarantine, Magic-Byte/ZIP Validation, Clamd Lease Fencing, SHA-256 Recovery & Session Revocation', () => {
  const db = getDb();
  const publicationService = new DbPublicationService(db);
  const authService = new DefaultAuthService(db);

  let countryId: string;
  let resourceTypeId: string;
  const cleanupResourceIds: string[] = [];
  const cleanupUserIds: string[] = [];

  beforeAll(async () => {
    await withDbRetry(() => runPlatformMigrations(db));

    const [c] = await db
      .select()
      .from(countries)
      .where(eq(countries.status, 'ACTIVE'))
      .limit(1);
    countryId = c.id;

    const [rt] = await db
      .select()
      .from(resourceTypes)
      .where(eq(resourceTypes.status, 'ACTIVE'))
      .limit(1);
    resourceTypeId = rt.id;
  }, 120000);

  afterAll(async () => {
    for (const rid of cleanupResourceIds) {
      const vers = await db
        .select({ id: resourceVersions.id })
        .from(resourceVersions)
        .where(eq(resourceVersions.resourceId, rid));

      // Reset any PUBLISHED test versions temporarily only in cleanup? No — published versions have immutable file triggers!
      // For non-published versions, delete files -> events -> versions -> resource cleanly.
      await db.delete(publicationEvents).where(eq(publicationEvents.resourceId, rid)).catch(() => {});
      for (const v of vers) {
        await db
          .update(resourceVersions)
          .set({ status: 'ARCHIVED' })
          .where(eq(resourceVersions.id, v.id))
          .catch(() => {});
        await db.delete(resourceFiles).where(eq(resourceFiles.resourceVersionId, v.id)).catch(() => {});
        await db.delete(resourceVersions).where(eq(resourceVersions.id, v.id)).catch(() => {});
      }
      await db.delete(resources).where(eq(resources.id, rid)).catch(() => {});
    }

    for (const uid of cleanupUserIds) {
      await db.delete(users).where(eq(users.id, uid)).catch(() => {});
    }

    await closeDatabase();
  });

  async function createDraftResourceAndVersion(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [res] = await db
      .insert(resources)
      .values({
        countryId,
        resourceTypeId,
        title: `W1 File Security ${label} ${suffix}`,
        slug: `w1-file-sec-${label}-${suffix}`.toLowerCase(),
        status: 'DRAFT',
      })
      .returning();
    cleanupResourceIds.push(res.id);

    const [ver] = await db
      .insert(resourceVersions)
      .values({
        resourceId: res.id,
        versionNumber: 1,
        versionLabel: 'v1.0.0',
        title: res.title,
        status: 'DRAFT',
      })
      .returning();

    return { resource: res, version: ver };
  }

  describe('W1-AC-09a: Pre-Upload Magic-Byte & ZIP/OOXML Structural Validator (415 Before Storage Write)', () => {
    it('rejects PE executables disguised as PDF, Zip-Slip OOXML paths, and >100:1 ZIP compression bombs with 415 and zero storage writes', async () => {
      const storage = new MemoryStorageProvider('w1-sig-bucket');
      const fileService = new FileStorageService(db, storage, 10 * 1024 * 1024, 'test');
      const { resource, version } = await createDraftResourceAndVersion('sig');

      // 1. Windows PE 'MZ' executable disguised as application/pdf
      const mzDisguisedAsPdf = Buffer.from('MZ\x90\x00\x03\x00\x00\x00FakeExecutablePayload');
      await expect(
        fileService.uploadResourceFile({
          resourceId: resource.id,
          resourceVersionId: version.id,
          originalFilename: 'notes.pdf',
          mimeType: 'application/pdf',
          buffer: mzDisguisedAsPdf,
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_FILE_SIGNATURE',
        statusCode: 415,
      });
      expect(storage.getStoredCount()).toBe(0);

      // 2. Zip-Slip traversal inside DOCX archive
      const zipSlipDocx = buildTestZipBuffer([
        { name: '[Content_Types].xml', content: Buffer.from('<Types/>') },
        { name: 'word/../../etc/passwd', content: Buffer.from('root:x:0:0') },
      ]);
      await expect(
        fileService.uploadResourceFile({
          resourceId: resource.id,
          resourceVersionId: version.id,
          originalFilename: 'traversal.docx',
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: zipSlipDocx,
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_FILE_SIGNATURE',
        statusCode: 415,
      });
      expect(storage.getStoredCount()).toBe(0);

      // 3. Compression-ratio bomb (>100:1 deflate ratio on 512 KiB of zeroes)
      const zeroBombDocx = buildTestZipBuffer([
        { name: '[Content_Types].xml', content: Buffer.from('<Types/>') },
        { name: 'word/document.xml', content: Buffer.alloc(512 * 1024, 0x41), deflate: true },
      ]);
      await expect(
        fileService.uploadResourceFile({
          resourceId: resource.id,
          resourceVersionId: version.id,
          originalFilename: 'bomb.docx',
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: zeroBombDocx,
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_FILE_SIGNATURE',
        statusCode: 415,
      });
      expect(storage.getStoredCount()).toBe(0);

      // 4. Valid DOCX archive passes validation and stages to quarantine/
      const validDocx = buildTestZipBuffer([
        { name: '[Content_Types].xml', content: Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') },
        { name: 'word/document.xml', content: Buffer.from('<w:document>CBC Grade 8 Notes</w:document>') },
      ]);
      const staged = await fileService.uploadResourceFile({
        resourceId: resource.id,
        resourceVersionId: version.id,
        originalFilename: 'cbc_grade8.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: validDocx,
      });
      expect(staged.status).toBe('PENDING');
      expect(staged.objectKey.startsWith('quarantine/test/resources/')).toBe(true);
      expect(storage.getStoredCount()).toBe(1);
    });
  });

  describe('W1-AC-09b: ClamdMalwareScanner TCP zINSTREAM Protocol (CLEAN, INFECTED, INSTREAM Size Limit Error)', () => {
    it('streams chunks over TCP zINSTREAM, quarantines INFECTED files, and treats INSTREAM size limit exceeded as retryable SCAN_ERROR (never CLEAN)', async () => {
      let clamdReply = 'stream: Win.Test.EICAR_HDB-1 FOUND';
      const mockClamd = await startMockClamdServer(() => clamdReply);

      try {
        const storage = new MemoryStorageProvider('w1-clamd-bucket');
        const fileService = new FileStorageService(db, storage, 10 * 1024 * 1024, 'test');
        const clamdScanner = new ClamdMalwareScanner({
          host: '127.0.0.1',
          port: mockClamd.port,
          timeoutMs: 5_000,
        });
        const worker = new FileProcessingWorker({
          db,
          storageProvider: storage,
          malwareScanner: clamdScanner,
        });

        // Case 1: Infected PDF -> QUARANTINED, never promoted to resources/
        const { resource: rInf, version: vInf } = await createDraftResourceAndVersion('infected');
        const infectedPdf = await fileService.uploadResourceFile({
          resourceId: rInf.id,
          resourceVersionId: vInf.id,
          originalFilename: 'infected.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\nEmbeddedMaliciousPayload'),
        });

        await worker.runOnce(infectedPdf.id);

        const quarantinedRow = (await fileService.getFileById(infectedPdf.id))!;
        expect(quarantinedRow.status).toBe('QUARANTINED');
        expect(quarantinedRow.malwareScanStatus).toBe('INFECTED');
        expect(quarantinedRow.malwareScanSignature).toBe('Win.Test.EICAR_HDB-1');
        expect(
          await storage.objectExists(
            `resources/${rInf.id}/versions/${vInf.id}/${infectedPdf.id}.pdf`,
          ),
        ).toBe(false);

        // Case 2: clamd returns "INSTREAM size limit exceeded. ERROR" -> rescheduled as PENDING retry (not CLEAN!)
        clamdReply = 'INSTREAM size limit exceeded. ERROR';
        const { resource: rLim, version: vLim } = await createDraftResourceAndVersion('sizelimit');
        const limitPdf = await fileService.uploadResourceFile({
          resourceId: rLim.id,
          resourceVersionId: vLim.id,
          originalFilename: 'large_valid.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\nLegitimate 30MB Textbook Sample'),
        });

        await worker.runOnce(limitPdf.id);

        const afterErrorFile = (await fileService.getFileById(limitPdf.id))!;
        expect(afterErrorFile.status).toBe('PENDING');
        const [jobAfterError] = await db
          .select()
          .from(fileProcessingJobs)
          .where(eq(fileProcessingJobs.fileId, limitPdf.id));
        expect(jobAfterError.status).toBe('PENDING');
        expect(jobAfterError.attemptCount).toBe(1);
        expect(jobAfterError.lastError).toContain('INSTREAM size limit exceeded');

        // Case 3: Once clamd is healthy ("stream: OK") and job is due -> promotes to AVAILABLE + CLEAN
        clamdReply = 'stream: OK';
        await db
          .update(fileProcessingJobs)
          .set({ nextRunAt: sql`NOW() - interval '5 seconds'` })
          .where(eq(fileProcessingJobs.id, jobAfterError.id));

        await worker.runOnce(limitPdf.id);

        const promotedRow = (await fileService.getFileById(limitPdf.id))!;
        expect(promotedRow.status).toBe('AVAILABLE');
        expect(promotedRow.malwareScanStatus).toBe('CLEAN');
        expect(promotedRow.objectKey).toBe(
          `resources/${rLim.id}/versions/${vLim.id}/${limitPdf.id}.pdf`,
        );
      } finally {
        await mockClamd.close();
      }
    });
  });

  describe('W1-AC-09c: Lease Heartbeat, Fencing Token Self-Abort (T-W1-LEASE-01) & SHA-256 Crash Recovery (T-W1-SHA-01)', () => {
    it('T-W1-LEASE-01: renews lease via heartbeat during slow scan and self-aborts immediately if fencing_token is superseded by Worker B', async () => {
      const storage = new MemoryStorageProvider('w1-lease-bucket');
      const fileService = new FileStorageService(db, storage, 10 * 1024 * 1024, 'test');

      // Subtest A: Slow clean scan (180ms) outliving 80ms lease via 25ms heartbeats succeeds cleanly
      const slowCleanScanner: MalwareScanner = {
        async scanStream(stream: Readable, opts?: MalwareScanOptions): Promise<MalwareScanResult> {
          for await (const _c of stream) {
            // drain
          }
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, 180);
            opts?.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(t);
                reject(new Error('Aborted'));
              },
              { once: true },
            );
          });
          return { status: 'CLEAN' };
        },
      };

      const { resource: rSlow, version: vSlow } = await createDraftResourceAndVersion('heartbeat');
      const slowFile = await fileService.uploadResourceFile({
        resourceId: rSlow.id,
        resourceVersionId: vSlow.id,
        originalFilename: 'slow_scan.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\nSlow scan heartbeat verification'),
      });

      const workerHeartbeat = new FileProcessingWorker({
        db,
        storageProvider: storage,
        malwareScanner: slowCleanScanner,
        leaseDurationMs: 400,
        heartbeatIntervalMs: 80,
      });
      await workerHeartbeat.runOnce(slowFile.id);

      const completedSlow = (await fileService.getFileById(slowFile.id))!;
      expect(completedSlow.status).toBe('AVAILABLE');
      expect(completedSlow.malwareScanStatus).toBe('CLEAN');

      // Subtest B: Fencing-token loss — Worker A stalls while Worker B reclaims job (fencing_token=2) and quarantines it;
      // Worker A's heartbeat detects 0 rows updated, fires AbortController.abort(), and NEVER overwrites Worker B's QUARANTINED state!
      const { resource: rFence, version: vFence } = await createDraftResourceAndVersion('fencing');
      const fencedFile = await fileService.uploadResourceFile({
        resourceId: rFence.id,
        resourceVersionId: vFence.id,
        originalFilename: 'fenced.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\nFencing token split-brain test'),
      });

      let signalAbortedObserved = false;
      let releaseStalledScan!: () => void;
      let workerA!: FileProcessingWorker;
      const scanStartedPromise = new Promise<void>((resolveStarted) => {
        const stalledScanner: MalwareScanner = {
          async scanStream(stream: Readable, opts?: MalwareScanOptions): Promise<MalwareScanResult> {
            for await (const _c of stream) {
              // drain
            }
            resolveStarted();
            await new Promise<void>((resolve) => {
              releaseStalledScan = resolve;
              opts?.signal?.addEventListener(
                'abort',
                () => {
                  signalAbortedObserved = true;
                  resolve();
                },
                { once: true },
              );
            });
            // Even if scanner tried returning CLEAN, Worker A must reject commit due to fencing token mismatch!
            return { status: 'CLEAN' };
          },
        };

        workerA = new FileProcessingWorker({
          db,
          storageProvider: storage,
          malwareScanner: stalledScanner,
          workerId: 'worker-A-stale',
          leaseDurationMs: 2500,
          heartbeatIntervalMs: 850,
        });
      });

      const workerAPromise = workerA.runOnce(fencedFile.id);
      await scanStartedPromise;

      // Simulate Worker A pause causing lease expiry while Worker B reclaims job with higher fencing_token (2) and marks QUARANTINED
      await db
        .update(fileProcessingJobs)
        .set({ leaseExpiresAt: sql`NOW() - interval '5 seconds'` })
        .where(eq(fileProcessingJobs.fileId, fencedFile.id));

      const workerB = new FileProcessingWorker({
        db,
        storageProvider: storage,
        malwareScanner: {
          async scanStream(s) {
            for await (const _ of s) { /* drain */ }
            return { status: 'INFECTED', signature: 'WorkerB.Authoritative.Malware' };
          },
        },
        workerId: 'worker-B-new-owner',
      });
      const bTick = await workerB.runOnce(fencedFile.id);
      expect(bTick.processed).toBe(1);

      // Now Worker A's 850ms heartbeat fires, sees fencing_token=2 (0 rows updated), and self-aborts via AbortController
      const safetyTimer = setTimeout(() => {
        releaseStalledScan?.();
      }, 4000);
      try {
        await workerAPromise;
      } finally {
        clearTimeout(safetyTimer);
      }

      expect(signalAbortedObserved).toBe(true);

      const finalFencedFile = (await fileService.getFileById(fencedFile.id))!;
      expect(finalFencedFile.status).toBe('QUARANTINED');
      expect(finalFencedFile.malwareScanStatus).toBe('INFECTED');
      expect(finalFencedFile.malwareScanSignature).toBe('WorkerB.Authoritative.Malware');
    });

    it('T-W1-SHA-01: crash recovery verifies full streaming SHA-256 + byte length on targetObjectKey (never trusting ETag) and re-promotes when target bytes are truncated', async () => {
      const storage = new MemoryStorageProvider('w1-sha-recovery-bucket');
      const fileService = new FileStorageService(db, storage, 10 * 1024 * 1024, 'test');
      const { resource, version } = await createDraftResourceAndVersion('sharecov');

      const authenticBytes = Buffer.from(
        '%PDF-1.4\nAuthentic Complete Curriculum Guide With Verified Digest 1234567890',
      );
      const expectedSha = crypto
        .createHash('sha256')
        .update(authenticBytes)
        .digest('hex')
        .toLowerCase();

      const staged = await fileService.uploadResourceFile({
        resourceId: resource.id,
        resourceVersionId: version.id,
        originalFilename: 'crash_recovery.pdf',
        mimeType: 'application/pdf',
        buffer: authenticBytes,
      });

      const [job] = await db
        .select()
        .from(fileProcessingJobs)
        .where(eq(fileProcessingJobs.fileId, staged.id));

      // Simulate previous worker crash AFTER recording cleanVerifiedSha256 and writing a TRUNCATED/CORRUPTED target object
      // whose ETag in storage metadata still looks plausible!
      await storage.copyObject({
        sourceKey: job.stagedObjectKey,
        destinationKey: job.targetObjectKey,
      });
      storage.overwriteRawBytesForTesting(
        job.targetObjectKey,
        Buffer.from('%PDF-1.4\nTRUNCATED'),
      );

      await db
        .update(fileProcessingJobs)
        .set({
          cleanVerifiedSha256: expectedSha,
          status: 'RUNNING',
          lockedBy: 'crashed-worker-0',
          fencingToken: 1,
          leaseExpiresAt: sql`NOW() - interval '5 seconds'`,
        })
        .where(eq(fileProcessingJobs.id, job.id));

      // Recovery worker claims expired job: must detect corrupt targetObjectKey via streaming SHA-256,
      // discard corrupt target bytes, re-copy from staged quarantine object, verify SHA-256, and promote!
      const recoveryWorker = new FileProcessingWorker({
        db,
        storageProvider: storage,
        malwareScanner: new StubCleanMalwareScanner(),
        workerId: 'recovery-worker-2',
      });
      await recoveryWorker.runOnce(staged.id);

      const recoveredFile = (await fileService.getFileById(staged.id))!;
      expect(recoveredFile.status).toBe('AVAILABLE');
      expect(recoveredFile.malwareScanStatus).toBe('CLEAN');
      expect(recoveredFile.objectKey).toBe(job.targetObjectKey);

      const finalStored = await storage.getObject(job.targetObjectKey);
      expect(finalStored.body.equals(authenticBytes)).toBe(true);
    });
  });

  describe('W1-AC-09d: Publication Gate (409 RESOURCE_FILES_NOT_READY) & Private No-Store Download Headers', () => {
    it('blocks publishing a version while attached file is PENDING/QUARANTINED (409) and serves Cache-Control: private, no-store after promotion', async () => {
      const storage = new MemoryStorageProvider('w1-pub-dl-bucket');
      const fileService = new FileStorageService(db, storage, 10 * 1024 * 1024, 'test');
      const downloadService = new DefaultDownloadService(db, storage, 300);
      const worker = new FileProcessingWorker({
        db,
        storageProvider: storage,
        malwareScanner: new StubCleanMalwareScanner(),
      });

      const { resource, version } = await createDraftResourceAndVersion('pubgate');

      const staged = await fileService.uploadResourceFile({
        resourceId: resource.id,
        resourceVersionId: version.id,
        originalFilename: 'grade6_science.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\nGrade 6 Science Notes'),
        isPrimary: true,
      });
      expect(staged.status).toBe('PENDING');

      // Advance workflow DRAFT -> IN_REVIEW -> APPROVED
      await publicationService.submitResourceForReview(resource.id);
      await publicationService.approveResource(resource.id);

      // Attempting to publish BEFORE FileProcessingWorker promotes staged file MUST fail with 409 RESOURCE_FILES_NOT_READY!
      await expect(
        publicationService.publishResourceVersion(resource.id, version.id),
      ).rejects.toMatchObject({
        code: 'RESOURCE_FILES_NOT_READY',
        statusCode: 409,
      });

      // Now run FileProcessingWorker -> promotes file to AVAILABLE + CLEAN
      await worker.runOnce(staged.id);

      // Publication now succeeds!
      const published = await publicationService.publishResourceVersion(
        resource.id,
        version.id,
      );
      expect(published.resource.status).toBe('PUBLISHED');

      // Verify HTTP download response sets Cache-Control: private, no-store and presigned URL carries response-cache-control
      const app = buildApp({
        services: { downloadService, authService },
      });
      await app.ready();

      try {
        const dlRes = await app.inject({
          method: 'POST',
          url: `/api/v1/resources/${resource.id}/download`,
        });
        expect(dlRes.statusCode).toBe(200);
        expect(dlRes.headers['cache-control']).toBe('private, no-store');
        expect(dlRes.json().data.downloadUrl).toContain(
          encodeURIComponent('private, no-store'),
        );
      } finally {
        await app.close();
      }
    });
  });

  describe('W1-AC-10: Password Change Session Revocation Across All Active Devices', () => {
    it('revokes all existing sessions across devices on POST /api/v1/auth/change-password and issues one fresh rotated session', async () => {
      const app = buildApp({ services: { authService } });
      await app.ready();

      try {
        const email = `w1-pw-rotate-${Date.now()}@example.com`;
        const oldPassword = 'InitialPassword123!';
        const newPassword = 'RotatedSecurePassword456!';

        // Device 1 registers
        const regRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: { email, password: oldPassword, displayName: 'Session Rotate User' },
        });
        expect(regRes.statusCode).toBe(201);
        cleanupUserIds.push(regRes.json().data.user.id);
        const device1Cookie = regRes.cookies.find((c) => c.name === SESSION_COOKIE_NAME)!.value;

        // Device 2 logs in independently
        const login2Res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email, password: oldPassword },
        });
        expect(login2Res.statusCode).toBe(200);
        const device2Cookie = login2Res.cookies.find((c) => c.name === SESSION_COOKIE_NAME)!.value;

        // Both Device 1 and Device 2 are authenticated before password change
        expect(
          (
            await app.inject({
              method: 'GET',
              url: '/api/v1/auth/me',
              headers: { cookie: `${SESSION_COOKIE_NAME}=${device1Cookie}` },
            })
          ).statusCode,
        ).toBe(200);
        expect(
          (
            await app.inject({
              method: 'GET',
              url: '/api/v1/auth/me',
              headers: { cookie: `${SESSION_COOKIE_NAME}=${device2Cookie}` },
            })
          ).statusCode,
        ).toBe(200);

        // Device 1 changes password via POST /api/v1/auth/change-password
        const changeRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/change-password',
          headers: { cookie: `${SESSION_COOKIE_NAME}=${device1Cookie}` },
          payload: {
            currentPassword: oldPassword,
            newPassword,
          },
        });
        expect(changeRes.statusCode).toBe(200);
        const rotatedCookie = changeRes.cookies.find((c) => c.name === SESSION_COOKIE_NAME)!.value;
        expect(rotatedCookie).toBeTruthy();
        expect(rotatedCookie).not.toBe(device1Cookie);

        // Prior Device 1 token AND prior Device 2 token MUST both be immediately revoked (401 UNAUTHENTICATED)!
        const stale1 = await app.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: { cookie: `${SESSION_COOKIE_NAME}=${device1Cookie}` },
        });
        expect(stale1.statusCode).toBe(401);

        const stale2 = await app.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: { cookie: `${SESSION_COOKIE_NAME}=${device2Cookie}` },
        });
        expect(stale2.statusCode).toBe(401);

        // Fresh rotated cookie succeeds (200)
        const activeRotated = await app.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: { cookie: `${SESSION_COOKIE_NAME}=${rotatedCookie}` },
        });
        expect(activeRotated.statusCode).toBe(200);

        // Old password login fails (401); new password login succeeds (200)
        const oldLogin = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email, password: oldPassword },
        });
        expect(oldLogin.statusCode).toBe(401);

        const newLogin = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email, password: newPassword },
        });
        expect(newLogin.statusCode).toBe(200);
      } finally {
        await app.close();
      }
    });
  });
});
