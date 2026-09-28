# File Storage Architecture (Cloudflare R2 + PostgreSQL/Neon)

**Project:** Kenya-First Education Resource Platform  
**Phase:** Prompt 09 — File Storage Layer  
**Storage Provider:** Cloudflare R2 (S3-Compatible API)  
**Database:** Managed Neon PostgreSQL (`files` schema)  

---

## 1. Architectural Overview

The education resource platform separates relational file metadata from binary payload bytes:

```text
Resource (content.resources)
   ↓ (1:N)
Resource Version (content.resource_versions)
   ↓ (1:N)
Resource File Metadata (files.resource_files)
   ↓
StorageProvider Abstraction
   ↓
CloudflareR2StorageProvider
   ↓
Cloudflare R2 Bucket (Object Storage)
```

- **PostgreSQL / Neon** remains the single source of truth for file metadata, version association, sequencing, primary file designations, and lifecycle statuses.
- **Cloudflare R2** stores the immutable binary object bytes via its S3-compatible API.
- The application domain layer depends strictly on the provider-neutral `StorageProvider` interface rather than directly coupling to vendor-specific Cloudflare SDK classes.

---

## 2. PostgreSQL Schema: `files.resource_files`

Defined in `files.resource_files` within the dedicated `files` logical schema:

| Column | Type | Constraints / Defaults | Description |
|---|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` | Immutable permanent file identifier |
| `resource_version_id` | `uuid` | FK `content.resource_versions(id) ON DELETE RESTRICT` | Parent resource version |
| `storage_provider` | `varchar(32)` | `NOT NULL DEFAULT 'CLOUDFLARE_R2'` | `CLOUDFLARE_R2`, `AWS_S3`, `MEMORY` |
| `storage_bucket` | `varchar(128)` | `NOT NULL` | Bucket identifier in storage provider |
| `object_key` | `varchar(512)` | `NOT NULL` | UUID-derived object key in R2 bucket |
| `original_filename` | `varchar(255)` | `NOT NULL` | Sanitized basename of the uploaded file |
| `file_extension` | `varchar(20)` | `NOT NULL` | Canonical lowercase file extension (e.g. pdf, docx) |
| `file_type` | `varchar(32)` | `NOT NULL DEFAULT 'MAIN_DOCUMENT'` | Controlled resource file role |
| `mime_type` | `varchar(100)` | `NOT NULL` | Whitelisted MIME type |
| `file_size_bytes` | `bigint` | `NOT NULL, CHECK (file_size_bytes > 0)` | Accurate binary length in bytes |
| `checksum_sha256` | `varchar(64)` | `NOT NULL, CHECK (length = 64)` | Lowercase 64-char hex SHA-256 hash |
| `storage_metadata` | `jsonb` | `DEFAULT '{}'::jsonb` | Provider/scanner structured metadata (ETags, scanner results, S3 headers) |
| `status` | `varchar(20)` | `NOT NULL DEFAULT 'AVAILABLE'` | `PENDING`, `AVAILABLE`, `QUARANTINED`, `ARCHIVED`, `FAILED` |
| `is_primary` | `boolean` | `NOT NULL DEFAULT false` | Indicates the primary file for the version |
| `sequence_order` | `integer` | `NOT NULL DEFAULT 1, CHECK (> 0)` | Deterministic display ordering |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Audit timestamp |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Audit timestamp |

### Integrity Constraints & Indexes
1. `uq_resource_files_bucket_key`: `UNIQUE (storage_bucket, object_key)` guarantees no two file records reference the same physical storage object.
2. `uq_resource_files_version_seq`: `UNIQUE (resource_version_id, sequence_order)` guarantees deterministic ordering without sequence clashes.
3. `uq_resource_files_version_checksum`: `UNIQUE (resource_version_id, checksum_sha256)` guarantees binary deduplication within a single resource version.
4. `uq_resource_files_primary_version`: Partial unique index `ON files.resource_files (resource_version_id) WHERE is_primary = true` ensures at most one primary file per version.
5. `chk_resource_files_file_type`: Restricts file roles to controlled types: `MAIN_DOCUMENT`, `MARKING_SCHEME`, `SUPPLEMENTARY`, `CURRICULUM_GUIDE`, `ACTIVITY_SHEET`, `AUDIO_RESOURCE`, `OTHER`.
6. `chk_resource_files_storage_provider`: Restricts storage providers to `CLOUDFLARE_R2`, `AWS_S3`, `MEMORY`.
7. `chk_resource_files_status`: Restricts lifecycle status to `PENDING`, `AVAILABLE`, `QUARANTINED`, `ARCHIVED`, `FAILED`.
8. B-tree indexes on `resource_version_id`, `checksum_sha256`, and `status`.

---

## 3. Publication Invariant: Engine-Level Triggers

**Core Invariant:** A file record cannot be modified, deleted, moved out of, or moved into a `PUBLISHED` resource version.

This invariant is enforced at the database engine level via PostgreSQL PL/pgSQL triggers:

1. **INSERT (`trg_prevent_published_resource_file_insert`):**
   Checks `NEW.resource_version_id`. If the parent version is `PUBLISHED`, raises exception code `23514` (`check_violation`).

2. **DELETE (`trg_prevent_published_resource_file_delete`):**
   Checks `OLD.resource_version_id`. If the parent version is `PUBLISHED`, raises exception code `23514`.

3. **UPDATE (`trg_prevent_published_resource_file_update`):**
   - Evaluates `OLD.resource_version_id`: rejects if current parent is `PUBLISHED` (prevents altering attributes or moving files out of published versions).
   - Evaluates `NEW.resource_version_id`: rejects if target parent is `PUBLISHED` (prevents moving files into published versions).
   - Permits legitimate pre-publication mutations when both `OLD` and `NEW` versions are non-published (e.g. `DRAFT`).

---

## 4. Object Key Generation & Filename Sanitization

### Key Generation Invariant
The original filename is **never** used as part of the storage key in Cloudflare R2. Keys are generated deterministically using UUIDs:

```text
resources/{resource_id}/versions/{resource_version_id}/{file_id}.{safe_extension}
```

This prevents:
- Namespace collisions
- User-supplied character encoding issues
- Directory traversal attacks
- Metadata leakage through object storage URLs

### Filename Sanitization
`sanitizeFilename(originalFilename)` performs:
- Basename extraction (stripping `/`, `\`, and directory paths)
- Removal of directory traversal patterns (`..`)
- Stripping of null bytes (`\0`) and non-printable control characters
- Filtering to a safe character set `[a-zA-Z0-9.\-_ ()]`
- Truncation to 255 characters maximum (with safe extension preserved)
- Fallback to safe default if empty (`unnamed_file`)

---

## 5. Synchronous Upload & Verification Flow

The standard upload flow synchronously establishes `AVAILABLE` status only upon verified byte and metadata round-tripping:

```text
1. Client Upload Request
       ↓
2. Service Validation
   - Parent version exists, matches resource, and is NOT published
   - MIME type is on whitelist
   - Buffer size > 0 and <= MAX_FILE_SIZE_BYTES
   - Sequence order >= 1
       ↓
3. Digest Computation
   - SHA-256 = crypto.createHash('sha256').update(buffer).digest('hex')
       ↓
4. Key & ID Generation
   - file_id = crypto.randomUUID()
   - object_key = resources/{resource_id}/versions/{version_id}/{file_id}.ext
       ↓
5. Storage Put
   - StorageProvider.putObject(key, body, contentType, metadata: { 'sha256-checksum': sha256 })
       ↓
6. Storage Verification Round-Trip
   - StorageProvider.headObject(key)
   - Verify object exists
   - Verify contentLength == buffer.length
   - Verify metadata['sha256-checksum'] == computed SHA-256
       ↓
   [If Verification Fails] → Compensating Cleanup: deleteObject(key) → Throw Error
       ↓
7. Database Persistence
   - Insert into files.resource_files with status = 'AVAILABLE'
       ↓
   [If DB Insert Fails] → Compensating Cleanup: deleteObject(key) → Rethrow Error
       ↓
8. Return Persisted Record
```

---

## 6. StorageProvider Abstraction

The platform provides a provider-neutral interface:

```typescript
export interface StorageProvider {
  putObject(params: PutObjectParams): Promise<PutObjectResult>;
  headObject(key: string): Promise<HeadObjectResult | null>;
  getObject(key: string): Promise<GetObjectResult>;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
  getProviderName(): string;
  getBucketName(): string;
}
```

Implementations:
- `CloudflareR2StorageProvider`: Production implementation utilizing `@aws-sdk/client-s3` configured for Cloudflare R2 endpoints (`https://<account_id>.r2.cloudflarestorage.com`) and S3-compatible credentials.
- `MemoryStorageProvider`: In-memory implementation faithfully simulating S3 metadata casing and headObject semantics for deterministic unit and integration testing.
