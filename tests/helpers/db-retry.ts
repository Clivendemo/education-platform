/**
 * Utility for retrying database operations that fail due to transient cloud
 * connection interruptions (e.g. serverless Neon cold starts, ETIMEDOUT, ECONNRESET).
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1500,
): Promise<T> {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (err: any) {
      const msg = `${err?.message || ''} ${err?.cause?.message || ''} ${err?.code || ''} ${err?.cause?.code || ''}`;
      const isTransient =
        msg.includes('ETIMEDOUT') ||
        msg.includes('ECONNRESET') ||
        msg.includes('Connection terminated') ||
        msg.includes('socket hang up') ||
        msg.includes('timeout');

      if (isTransient && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
        continue;
      }
      throw err;
    }
  }
}
