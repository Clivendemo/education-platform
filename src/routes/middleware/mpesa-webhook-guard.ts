import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { extractCallbackAmountLexeme } from '../../services/commerce/mpesa/mpesa-payment-provider.js';

export const MPESA_WEBHOOK_BODY_LIMIT_BYTES = 32 * 1024; // 32 KiB

export interface MpesaWebhookRateLimiterOptions {
  capacity?: number; // Default: 20 burst
  refillTokensPerSec?: number; // Default: 1 token/sec (60 req/min)
  entryTtlMs?: number; // Default: 600_000 ms (10 minutes)
  maxEntries?: number; // Default: 10_000 distinct IPs
  nowFn?: () => number;
}

interface TokenBucketEntry {
  tokens: number;
  lastRefillAt: number;
  lastSeenAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Deterministic bounded-LRU per-IP token bucket limiter for unauthenticated M-Pesa webhooks (`W1-AC-08`).
 * - Burst capacity: `20`
 * - Sustained refill: `1 token/sec` (`60 req/min`)
 * - Idle TTL eviction: `600_000 ms` (`10 minutes`)
 * - Hard cardinality cap: `10_000` distinct IPs (`O(1)` Map-order LRU eviction)
 */
export class MpesaWebhookRateLimiter {
  private readonly buckets = new Map<string, TokenBucketEntry>();
  private readonly capacity: number;
  private readonly refillTokensPerSec: number;
  private readonly entryTtlMs: number;
  private readonly maxEntries: number;
  private readonly nowFn: () => number;

  constructor(options: MpesaWebhookRateLimiterOptions = {}) {
    this.capacity = options.capacity ?? 20;
    this.refillTokensPerSec = options.refillTokensPerSec ?? 1;
    this.entryTtlMs = options.entryTtlMs ?? 600_000;
    this.maxEntries = options.maxEntries ?? 10_000;
    this.nowFn = options.nowFn ?? Date.now;
  }

  consume(rawKey: string): RateLimitDecision {
    const key = rawKey && rawKey.trim().length > 0 ? rawKey.trim() : 'unknown';
    const now = this.nowFn();

    // 1. Lazy TTL prune from oldest head entries (Map maintains LRU order)
    for (const [entryKey, entry] of this.buckets.entries()) {
      if (now - entry.lastSeenAt >= this.entryTtlMs) {
        this.buckets.delete(entryKey);
      } else {
        // Since entries are ordered oldest-lastSeenAt first, we can stop scanning once fresh
        break;
      }
    }

    let bucket = this.buckets.get(key);

    if (bucket) {
      // Refresh LRU position: delete and re-insert at tail
      this.buckets.delete(key);
      const elapsedSec = Math.max(0, (now - bucket.lastRefillAt) / 1000);
      bucket.tokens = Math.min(
        this.capacity,
        bucket.tokens + elapsedSec * this.refillTokensPerSec,
      );
      bucket.lastRefillAt = now;
      bucket.lastSeenAt = now;
      this.buckets.set(key, bucket);
    } else {
      // Enforce hard cardinality cap via O(1) LRU eviction of oldest key
      if (this.buckets.size >= this.maxEntries) {
        const oldestKey = this.buckets.keys().next().value;
        if (oldestKey !== undefined) {
          this.buckets.delete(oldestKey);
        }
      }
      bucket = {
        tokens: this.capacity,
        lastRefillAt: now,
        lastSeenAt: now,
      };
      this.buckets.set(key, bucket);
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        retryAfterSeconds: 0,
      };
    }

    const deficit = 1 - bucket.tokens;
    const retryAfterSeconds = Math.max(1, Math.ceil(deficit / this.refillTokensPerSec));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  get size(): number {
    return this.buckets.size;
  }

  has(key: string): boolean {
    return this.buckets.has(key);
  }

  clear(): void {
    this.buckets.clear();
  }
}

export const defaultMpesaWebhookRateLimiter = new MpesaWebhookRateLimiter();

/**
 * Registers an encapsulated JSON parser on a webhook sub-scope that:
 * 1. Captures the raw JSON string before `JSON.parse`
 * 2. Extracts the exact `Amount` lexeme string (`__rawAmountLexeme`) without float precision loss
 */
export function registerRawDecimalWebhookJsonParser(scope: FastifyInstance): void {
  scope.removeContentTypeParser('application/json');
  scope.addContentTypeParser(
    'application/json',
    { parseAs: 'string', bodyLimit: MPESA_WEBHOOK_BODY_LIMIT_BYTES },
    (_req, body, done) => {
      try {
        const rawText = typeof body === 'string' ? body : body.toString('utf8');
        const parsed = JSON.parse(rawText);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const rawAmountLexeme = extractCallbackAmountLexeme(rawText);
          if (rawAmountLexeme !== undefined) {
            Object.defineProperty(parsed, '__rawAmountLexeme', {
              value: rawAmountLexeme,
              enumerable: false,
              configurable: true,
            });
          }
        }
        done(null, parsed);
      } catch (err) {
        const syntaxErr = err as Error & { statusCode?: number; code?: string };
        syntaxErr.statusCode = 400;
        syntaxErr.code = 'INVALID_CALLBACK_PAYLOAD';
        done(syntaxErr, undefined);
      }
    },
  );
}

export function createMpesaWebhookPreHandler(
  limiter: MpesaWebhookRateLimiter = defaultMpesaWebhookRateLimiter,
) {
  return async function mpesaWebhookGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const decision = limiter.consume(request.ip);
    if (!decision.allowed) {
      reply.header('Retry-After', String(decision.retryAfterSeconds));
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many webhook requests from this source IP.',
          requestId: request.id,
        },
      });
    }
  };
}
