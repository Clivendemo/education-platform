/**
 * Utility for retrying database operations that fail due to transient cloud
 * connection interruptions (e.g. serverless Neon cold starts, ETIMEDOUT, ECONNRESET).
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 4,
  delayMs = 2000,
): Promise<T> {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (err: any) {
      const aggregateMsgs = Array.isArray(err?.errors)
        ? err.errors.map((e: any) => `${e?.message || ''} ${e?.code || ''}`).join(' ')
        : '';
      const msg = `${err?.message || ''} ${err?.cause?.message || ''} ${err?.code || ''} ${err?.cause?.code || ''} ${aggregateMsgs}`;
      const isTransient =
        msg.includes('ETIMEDOUT') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('EAI_AGAIN') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('Connection terminated') ||
        msg.includes('socket hang up') ||
        msg.includes('timeout') ||
        msg.includes('connect');

      if (isTransient && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
        continue;
      }
      throw err;
    }
  }
}
