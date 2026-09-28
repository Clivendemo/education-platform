import { describe, it, expect } from 'vitest';
import { MemoryStorageProvider } from '../../src/services/storage/memory-storage-provider.js';
import { CloudflareR2StorageProvider } from '../../src/services/storage/r2-storage-provider.js';
import {
  sanitizeFilename,
  generateStorageKey,
  getSafeExtension,
} from '../../src/services/storage/file-key.js';

describe('Prompt 09: Storage Provider & File Key Unit Tests', () => {
  describe('1. File Key & Sanitization Rules', () => {
    it('strips directory traversal patterns and path separators from filenames', () => {
      expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd');
      expect(sanitizeFilename('..\\..\\windows\\system32\\config.sys')).toBe('config.sys');
      expect(sanitizeFilename('/nested/dir/my-test-file.pdf')).toBe('my-test-file.pdf');
      expect(sanitizeFilename('C:\\Documents\\KCSE_2025.pdf')).toBe('KCSE_2025.pdf');
    });

    it('strips null bytes and non-printable control characters', () => {
      const malicious = 'normal_file\x00_hidden.exe.pdf\r\n';
      const sanitized = sanitizeFilename(malicious);
      expect(sanitized).not.toContain('\x00');
      expect(sanitized).not.toContain('\r');
      expect(sanitized).not.toContain('\n');
      expect(sanitized).toBe('normal_file_hidden.exe.pdf');
    });

    it('falls back safely for empty or pure-dot strings', () => {
      expect(sanitizeFilename('')).toBe('file.bin');
      expect(sanitizeFilename('....')).toBe('unnamed_file');
      expect(sanitizeFilename('   ')).toBe('unnamed_file');
    });

    it('enforces maximum 255 character length', () => {
      const longName = 'a'.repeat(300) + '.pdf';
      const sanitized = sanitizeFilename(longName);
      expect(sanitized.length).toBeLessThanOrEqual(255);
      expect(sanitized.endsWith('.pdf')).toBe(true);
    });

    it('generates deterministic UUID storage keys without ever using original filename', () => {
      const resourceId = '00000000-0000-0000-0000-000000000001';
      const resourceVersionId = '00000000-0000-0000-0000-000000000002';
      const fileId = '00000000-0000-0000-0000-000000000003';
      const originalFilename = 'my_super_secret_contributor_filename.pdf';

      const key = generateStorageKey({
        resourceId,
        resourceVersionId,
        fileId,
        safeExtension: 'pdf',
      });

      expect(key).toBe(`resources/${resourceId}/versions/${resourceVersionId}/${fileId}.pdf`);
      expect(key).not.toContain(originalFilename);
      expect(key).not.toContain('contributor');
    });

    it('correctly maps MIME types and filenames to safe lowercase extensions', () => {
      expect(getSafeExtension('file.PDF', 'application/pdf')).toBe('pdf');
      expect(getSafeExtension('exam', 'application/pdf')).toBe('pdf');
      expect(getSafeExtension('archive', 'application/octet-stream')).toBe('bin');
      expect(getSafeExtension('lesson.DOCX')).toBe('docx');
    });
  });

  describe('2. MemoryStorageProvider Semantics', () => {
    const provider = new MemoryStorageProvider('test-r2-bucket');

    it('correctly identifies provider name and bucket', () => {
      expect(provider.getProviderName()).toBe('MEMORY');
      expect(provider.getBucketName()).toBe('test-r2-bucket');
    });

    it('stores objects, normalizes metadata keys to lowercase, and verifies headObject', async () => {
      const buffer = Buffer.from('Kenya Curriculum Educational Resource Bytes');
      const key = 'test/file-1.pdf';

      await provider.putObject({
        key,
        body: buffer,
        contentType: 'application/pdf',
        metadata: {
          SHA256: 'deadbeef1234',
          'Custom-Header': 'TestValue',
        },
      });

      const exists = await provider.objectExists(key);
      expect(exists).toBe(true);

      const head = await provider.headObject(key);
      expect(head).not.toBeNull();
      expect(head!.contentLength).toBe(buffer.length);
      expect(head!.contentType).toBe('application/pdf');
      // S3 metadata normalization: keys are lowercase
      expect(head!.metadata['sha256']).toBe('deadbeef1234');
      expect(head!.metadata['custom-header']).toBe('TestValue');

      const retrieved = await provider.getObject(key);
      expect(retrieved.body.equals(buffer)).toBe(true);
    });

    it('returns null on headObject for non-existent objects', async () => {
      const head = await provider.headObject('non-existent-key');
      expect(head).toBeNull();

      const exists = await provider.objectExists('non-existent-key');
      expect(exists).toBe(false);
    });

    it('deletes objects cleanly', async () => {
      const key = 'test/to-delete.pdf';
      await provider.putObject({
        key,
        body: Buffer.from('hello'),
        contentType: 'text/plain',
      });

      expect(await provider.objectExists(key)).toBe(true);
      await provider.deleteObject(key);
      expect(await provider.objectExists(key)).toBe(false);
    });
  });

  describe('3. CloudflareR2StorageProvider Initialization & S3 Configuration', () => {
    it('initializes with Cloudflare R2 endpoint and credentials', () => {
      const r2 = new CloudflareR2StorageProvider({
        accountId: 'test-account-id',
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
        bucketName: 'kenya-education-platform-files',
      });

      expect(r2.getProviderName()).toBe('CLOUDFLARE_R2');
      expect(r2.getBucketName()).toBe('kenya-education-platform-files');
    });

    it('accepts custom endpoint override', () => {
      const r2 = new CloudflareR2StorageProvider({
        endpoint: 'https://custom-r2-endpoint.example.com',
        bucketName: 'custom-bucket',
      });

      expect(r2.getBucketName()).toBe('custom-bucket');
    });
  });
});
