import { FileStorageError, type AllowedMimeType } from '../file-storage.service.js';

const ZIP_LOCAL_FILE_HEADER_SIG = 0x04034b50;
const ZIP_CENTRAL_DIR_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;

export const MAX_ARCHIVE_ENTRIES = 1000;
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 250 * 1024 * 1024; // 250 MiB
export const MAX_ARCHIVE_COMPRESSION_RATIO = 100;

export interface ZipInspectionResult {
  entryCount: number;
  totalUncompressedBytes: number;
  entryNames: string[];
}

/**
 * Inspects a ZIP container's End of Central Directory (EOCD) and Central Directory headers
 * without extracting untrusted payloads to disk.
 * Rejects:
 * - Missing or truncated local file header / EOCD
 * - Zip-Slip path traversal (`..`, absolute `/` or `\`, drive prefixes, null bytes)
 * - Archive bombs (entry count > 1000, uncompressed total > 250 MiB, or compression ratio > 100:1)
 * - Encrypted or ZIP64 unsupported headers pretending to be standard documents
 */
export function inspectZipContainer(buffer: Buffer): ZipInspectionResult {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== ZIP_LOCAL_FILE_HEADER_SIG) {
    throw new FileStorageError(
      'Invalid ZIP/OOXML container: missing PK local file header signature.',
      'INVALID_FILE_SIGNATURE',
      415,
    );
  }

  // Locate EOCD record within last 65,557 bytes (22-byte header + max 65,535-byte comment)
  const minEocdOffset = Math.max(0, buffer.length - 65_557);
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= minEocdOffset; i--) {
    if (buffer.readUInt32LE(i) === ZIP_EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new FileStorageError(
      'Invalid ZIP/OOXML container: missing End of Central Directory record.',
      'INVALID_FILE_SIGNATURE',
      415,
    );
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (
    totalEntries === 0xffff ||
    centralDirSize === 0xffffffff ||
    centralDirOffset === 0xffffffff
  ) {
    throw new FileStorageError(
      'ZIP64 archives are not permitted for educational document uploads.',
      'INVALID_FILE_SIGNATURE',
      415,
    );
  }

  if (totalEntries === 0 || totalEntries > MAX_ARCHIVE_ENTRIES) {
    throw new FileStorageError(
      `Archive entry count (${totalEntries}) violates allowed bounds (1..${MAX_ARCHIVE_ENTRIES}).`,
      'INVALID_FILE_SIGNATURE',
      415,
    );
  }

  if (
    centralDirOffset >= buffer.length ||
    centralDirOffset + centralDirSize > eocdOffset
  ) {
    throw new FileStorageError(
      'Corrupt ZIP Central Directory bounds.',
      'INVALID_FILE_SIGNATURE',
      415,
    );
  }

  let cursor = centralDirOffset;
  let totalUncompressedBytes = 0;
  let totalCompressedBytes = 0;
  const entryNames: string[] = [];

  for (let idx = 0; idx < totalEntries; idx++) {
    if (cursor + 46 > eocdOffset || buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_DIR_SIG) {
      throw new FileStorageError(
        'Corrupt ZIP Central Directory file header.',
        'INVALID_FILE_SIGNATURE',
        415,
      );
    }

    const gpBitFlag = buffer.readUInt16LE(cursor + 8);
    if ((gpBitFlag & 0x0001) !== 0) {
      throw new FileStorageError(
        'Password-encrypted ZIP/OOXML archives cannot be scanned and are rejected.',
        'INVALID_FILE_SIGNATURE',
        415,
      );
    }

    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const fileNameLen = buffer.readUInt16LE(cursor + 28);
    const extraFieldLen = buffer.readUInt16LE(cursor + 30);
    const fileCommentLen = buffer.readUInt16LE(cursor + 32);

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new FileStorageError(
        'ZIP64 extended size headers are not permitted.',
        'INVALID_FILE_SIGNATURE',
        415,
      );
    }

    const nameStart = cursor + 46;
    const nameEnd = nameStart + fileNameLen;
    if (nameEnd + extraFieldLen + fileCommentLen > eocdOffset) {
      throw new FileStorageError(
        'Truncated ZIP Central Directory entry metadata.',
        'INVALID_FILE_SIGNATURE',
        415,
      );
    }

    const rawNameBytes = buffer.subarray(nameStart, nameEnd);
    if (rawNameBytes.includes(0x00)) {
      throw new FileStorageError(
        'Null byte detected in archive entry filename.',
        'INVALID_FILE_SIGNATURE',
        415,
      );
    }

    const entryName = rawNameBytes.toString('utf8');
    // Reject Zip-Slip traversal: leading slash/backslash, Windows drive letter, or '..' path segments
    if (
      entryName.startsWith('/') ||
      entryName.startsWith('\\') ||
      /^[a-zA-Z]:/.test(entryName) ||
      entryName.includes('\\')
    ) {
      throw new FileStorageError(
        'Unsafe path separator or absolute path detected in archive entry.',
        'INVALID_FILE_SIGNATURE',
        415,
      );
    }

    const segments = entryName.split('/');
    if (segments.some((seg) => seg === '..')) {
      throw new FileStorageError(
        'Path traversal ("..") detected in archive entry.',
        'INVALID_FILE_SIGNATURE',
        415,
      );
    }

    totalCompressedBytes += compressedSize;
    totalUncompressedBytes += uncompressedSize;

    if (totalUncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new FileStorageError(
        `Archive uncompressed size exceeds maximum threshold (${MAX_ARCHIVE_UNCOMPRESSED_BYTES} bytes).`,
        'INVALID_FILE_SIGNATURE',
        415,
      );
    }

    if (
      uncompressedSize > 64 * 1024 &&
      (compressedSize === 0 ||
        uncompressedSize / compressedSize > MAX_ARCHIVE_COMPRESSION_RATIO)
    ) {
      throw new FileStorageError(
        `Archive entry exceeds maximum permitted compression ratio (${MAX_ARCHIVE_COMPRESSION_RATIO}:1).`,
        'INVALID_FILE_SIGNATURE',
        415,
      );
    }

    entryNames.push(entryName);
    cursor = nameEnd + extraFieldLen + fileCommentLen;
  }

  if (
    totalUncompressedBytes > 64 * 1024 &&
    (totalCompressedBytes === 0 ||
      totalUncompressedBytes / totalCompressedBytes > MAX_ARCHIVE_COMPRESSION_RATIO)
  ) {
    throw new FileStorageError(
      'Archive overall compression ratio exceeds safety bounds.',
      'INVALID_FILE_SIGNATURE',
      415,
    );
  }

  return {
    entryCount: totalEntries,
    totalUncompressedBytes,
    entryNames,
  };
}

/**
 * Validates binary magic bytes and container structure against the declared MIME type
 * BEFORE any object is written to storage (W1-AC-09).
 */
export function validateUploadedFileSignature(
  buffer: Buffer,
  mimeType: AllowedMimeType,
): void {
  // Universal executable header rejection across all allowed MIME types
  if (
    (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) || // Windows PE 'MZ'
    (buffer.length >= 4 &&
      buffer[0] === 0x7f &&
      buffer[1] === 0x45 &&
      buffer[2] === 0x4c &&
      buffer[3] === 0x46) // Linux ELF '\x7fELF'
  ) {
    throw new FileStorageError(
      'Executable binary payloads (PE/ELF) are strictly prohibited.',
      'INVALID_FILE_SIGNATURE',
      415,
    );
  }

  switch (mimeType) {
    case 'application/pdf': {
      if (
        buffer.length < 5 ||
        buffer.subarray(0, 5).toString('ascii') !== '%PDF-'
      ) {
        throw new FileStorageError(
          'File content does not match declared application/pdf signature (%PDF-).',
          'INVALID_FILE_SIGNATURE',
          415,
        );
      }
      return;
    }

    case 'image/png': {
      const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (buffer.length < 8 || !buffer.subarray(0, 8).equals(pngMagic)) {
        throw new FileStorageError(
          'File content does not match declared image/png signature.',
          'INVALID_FILE_SIGNATURE',
          415,
        );
      }
      return;
    }

    case 'image/jpeg': {
      if (
        buffer.length < 3 ||
        buffer[0] !== 0xff ||
        buffer[1] !== 0xd8 ||
        buffer[2] !== 0xff
      ) {
        throw new FileStorageError(
          'File content does not match declared image/jpeg signature.',
          'INVALID_FILE_SIGNATURE',
          415,
        );
      }
      return;
    }

    case 'image/webp': {
      if (
        buffer.length < 12 ||
        buffer.subarray(0, 4).toString('ascii') !== 'RIFF' ||
        buffer.subarray(8, 12).toString('ascii') !== 'WEBP'
      ) {
        throw new FileStorageError(
          'File content does not match declared image/webp RIFF/WEBP signature.',
          'INVALID_FILE_SIGNATURE',
          415,
        );
      }
      return;
    }

    case 'application/msword':
    case 'application/vnd.ms-excel':
    case 'application/vnd.ms-powerpoint': {
      const ole2Magic = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      if (buffer.length < 8 || !buffer.subarray(0, 8).equals(ole2Magic)) {
        throw new FileStorageError(
          `File content does not match declared OLE2 binary signature for ${mimeType}.`,
          'INVALID_FILE_SIGNATURE',
          415,
        );
      }
      return;
    }

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
      const zipInfo = inspectZipContainer(buffer);
      if (!zipInfo.entryNames.includes('[Content_Types].xml')) {
        throw new FileStorageError(
          `Invalid OOXML archive for ${mimeType}: missing required [Content_Types].xml manifest.`,
          'INVALID_FILE_SIGNATURE',
          415,
        );
      }
      const requiredPrefix =
        mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          ? 'word/'
          : mimeType ===
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            ? 'xl/'
            : 'ppt/';
      if (!zipInfo.entryNames.some((n) => n.startsWith(requiredPrefix))) {
        throw new FileStorageError(
          `Invalid OOXML archive for ${mimeType}: missing ${requiredPrefix} document structure.`,
          'INVALID_FILE_SIGNATURE',
          415,
        );
      }
      return;
    }

    case 'application/epub+zip': {
      const zipInfo = inspectZipContainer(buffer);
      if (!zipInfo.entryNames.includes('META-INF/container.xml')) {
        throw new FileStorageError(
          'Invalid EPUB archive: missing required META-INF/container.xml.',
          'INVALID_FILE_SIGNATURE',
          415,
        );
      }
      return;
    }

    case 'text/plain': {
      if (buffer.includes(0x00)) {
        throw new FileStorageError(
          'Binary null bytes are not permitted in text/plain files.',
          'INVALID_FILE_SIGNATURE',
          415,
        );
      }
      let decoded: string;
      try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        decoded = decoder.decode(buffer);
      } catch {
        throw new FileStorageError(
          'text/plain uploads must be valid UTF-8 text.',
          'INVALID_FILE_SIGNATURE',
          415,
        );
      }
      const leading = decoded.slice(0, 512).trimStart().toLowerCase();
      if (
        leading.startsWith('#!') ||
        leading.startsWith('<script') ||
        leading.startsWith('<!doctype html') ||
        leading.startsWith('<html')
      ) {
        throw new FileStorageError(
          'Executable scripts or active HTML documents disguised as text/plain are rejected.',
          'INVALID_FILE_SIGNATURE',
          415,
        );
      }
      return;
    }

    case 'audio/mpeg': {
      const hasId3 =
        buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3';
      const hasMpegSync =
        buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
      if (!hasId3 && !hasMpegSync) {
        throw new FileStorageError(
          'File content does not match declared audio/mpeg (ID3/MP3) signature.',
          'INVALID_FILE_SIGNATURE',
          415,
        );
      }
      return;
    }

    case 'audio/mp4': {
      if (
        buffer.length < 8 ||
        buffer.subarray(4, 8).toString('ascii') !== 'ftyp'
      ) {
        throw new FileStorageError(
          'File content does not match declared audio/mp4 ISO BMFF (ftyp) signature.',
          'INVALID_FILE_SIGNATURE',
          415,
        );
      }
      return;
    }

    case 'audio/ogg': {
      if (
        buffer.length < 4 ||
        buffer.subarray(0, 4).toString('ascii') !== 'OggS'
      ) {
        throw new FileStorageError(
          'File content does not match declared audio/ogg (OggS) signature.',
          'INVALID_FILE_SIGNATURE',
          415,
        );
      }
      return;
    }
  }
}
