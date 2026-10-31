# ClamAV (`clamd`) Deployment & Cloudflare R2 Quarantine Lifecycle

## 1. Required `clamd.conf` Stream & Archive Limits

The platform enforces a default `MAX_FILE_SIZE_BYTES = 52428800` (`50 MiB`). ClamAV's default `StreamMaxLength` (`25M`) is smaller than `50 MiB` and would emit `INSTREAM size limit exceeded. ERROR` for legitimate educational uploads between `25 MiB` and `50 MiB`.

Production `clamd` sidecars / private services **must** configure `StreamMaxLength` and `MaxFileSize` strictly above `MAX_FILE_SIZE_BYTES`:

```conf
# Network socket (VPC-internal only; never expose publicly)
TCPSocket 3310
TCPAddr 0.0.0.0

# Must exceed application MAX_FILE_SIZE_BYTES (50 MiB = 52,428,800 bytes)
StreamMaxLength 55M
MaxFileSize 55M
MaxScanSize 150M

# Archive & container recursion bounds aligned with file-signature-validator.ts
ScanArchive yes
ScanOLE2 yes
ScanPDF yes
MaxRecursion 16
MaxFiles 1000
AlertExceedsMax yes
```

### Application Environment Variables (Production)

```env
MALWARE_SCANNER_MODE=CLAMD
CLAMD_HOST=clamav.internal
CLAMD_PORT=3310
CLAMD_TIMEOUT_MS=60000
```

Startup validation in `src/config/env.ts` fails fast if `NODE_ENV=production` and `MALWARE_SCANNER_MODE` is not `CLAMD` or `CLAMD_HOST` is unset.

---

## 2. Failure & Verdict Handling Semantics

| `clamd` Response / Socket Event | Mapped Verdict | `file_processing_jobs.status` | `resource_files.status` |
| --- | --- | --- | --- |
| `stream: OK` | `CLEAN` | `COMPLETED` (after target SHA-256 verification) | `AVAILABLE` |
| `stream: <Signature> FOUND` | `INFECTED` | `QUARANTINED` (terminal; never retried) | `QUARANTINED` |
| `INSTREAM size limit exceeded. ERROR`, socket timeout, reset, or empty reply | `SCAN_ERROR` | Retried with exponential backoff up to `max_attempts` (`5`), then `FAILED` | `PENDING` while retrying, then `FAILED` |

No file with `status <> 'AVAILABLE'` can be published (`PublicationService.publishResourceVersion` returns `409 RESOURCE_FILES_NOT_READY`) or downloaded (`DownloadService.generateDownloadUrl` rejects non-`AVAILABLE` files).

---

## 3. Cloudflare R2 Quarantine Prefix Lifecycle Rule

All newly uploaded files are staged exclusively under:

```text
quarantine/{NODE_ENV}/resources/{resourceId}/versions/{resourceVersionId}/{fileId}.{ext}
```

Configure the following Object Lifecycle rule on the Cloudflare R2 bucket so orphaned or quarantined objects are automatically purged without manual intervention:

1. **Prefix filter**: `quarantine/`
2. **Delete uploaded objects**: Expire after **7 days** (`Expiration: 7 days`)
3. **Abort incomplete multipart uploads**: Abort after **1 day** (`AbortIncompleteMultipartUpload: 1 day`)
