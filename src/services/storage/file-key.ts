import path from 'node:path';

/**
 * Standard MIME to safe file extension map
 */
const MIME_EXTENSION_MAP: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/epub+zip': 'epub',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
};

/**
 * Derives a safe file extension from original filename and optional MIME type.
 * Alphanumeric only, lowercase, 1-10 characters.
 */
export function getSafeExtension(
  filename: string,
  mimeType?: string,
): string {
  // Try to extract from filename first
  const parsedExt = path.extname(filename).toLowerCase().replace(/^\./, '');
  if (/^[a-z0-9]{1,10}$/.test(parsedExt)) {
    return parsedExt;
  }

  // Fallback to MIME type map
  if (mimeType && MIME_EXTENSION_MAP[mimeType.toLowerCase()]) {
    return MIME_EXTENSION_MAP[mimeType.toLowerCase()];
  }

  return 'bin';
}

/**
 * Sanitizes an original filename to ensure safe, predictable database storage.
 * - Extracts basename only, discarding all directory path separators (/, \\)
 * - Removes directory traversal patterns (..)
 * - Strips control characters, null bytes, and non-printable characters
 * - Restricts characters to safe set (alphanumeric, spaces, dashes, underscores, dots)
 * - Limits length to max 255 characters
 * - Never returns an empty string (falls back to 'file')
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    return 'file.bin';
  }

  // Normalize path separators to forward slash, then get basename
  const normalized = filename.replace(/\\/g, '/');
  let basename = path.basename(normalized);

  // Remove null bytes and non-printable control characters
  basename = basename.replace(/[\x00-\x1F\x7F-\x9F]/g, '');

  // Strip traversal attempts like ".." or "..."
  basename = basename.replace(/\.{2,}/g, '.');

  // Replace disallowed characters with an underscore
  // Allowed: unicode alphanumeric, spaces, dots, dashes, underscores, parentheses
  basename = basename.replace(/[^a-zA-Z0-9.\-_ ()]/g, '_');

  // Trim leading/trailing whitespace and dots
  basename = basename.trim().replace(/^\.+/, '').replace(/\.+$/, '');

  // If empty after sanitization, provide a fallback
  if (basename.length === 0) {
    basename = 'unnamed_file';
  }

  // Ensure length does not exceed 255 characters (PostgreSQL varchar(255))
  if (basename.length > 255) {
    const ext = path.extname(basename);
    const stem = basename.slice(0, 255 - ext.length);
    basename = stem + ext;
  }

  return basename;
}

export interface StorageKeyParams {
  resourceId: string;
  resourceVersionId: string;
  fileId: string;
  safeExtension?: string;
}

/**
 * Generates an immutable, UUID-derived storage object key.
 *
 * Invariant:
 * The original filename is NEVER used as part of the storage key in Cloudflare R2.
 * Keys are strictly structured by resource UUID, version UUID, and file UUID.
 * Format: resources/{resourceId}/versions/{resourceVersionId}/{fileId}[.{safeExtension}]
 */
export function generateStorageKey(params: StorageKeyParams): string {
  const { resourceId, resourceVersionId, fileId, safeExtension } = params;

  if (!resourceId || !resourceVersionId || !fileId) {
    throw new Error('resourceId, resourceVersionId, and fileId are all strictly required for storage key generation');
  }

  const ext = safeExtension ? `.${safeExtension.replace(/^\./, '').toLowerCase()}` : '';
  return `resources/${resourceId}/versions/${resourceVersionId}/${fileId}${ext}`;
}
