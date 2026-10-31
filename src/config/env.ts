import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file if available (allowing .env overrides)
dotenv.config({ override: true });

const ACCEPTABLE_PRODUCTION_SSL_MODES = ['require', 'verify-ca', 'verify-full'];

/**
 * Strict boolean environment parser that avoids `z.coerce.boolean()` pitfalls
 * (`Boolean("false") === true`).
 */
function strictEnvBoolean(defaultValue: boolean) {
  return z.preprocess((val) => {
    if (val === undefined || val === null) {
      return defaultValue;
    }
    if (typeof val === 'boolean') {
      return val;
    }
    if (typeof val === 'string') {
      const normalized = val.trim().toLowerCase();
      if (normalized === '') {
        return defaultValue;
      }
      if (normalized === 'true' || normalized === '1') {
        return true;
      }
      if (normalized === 'false' || normalized === '0') {
        return false;
      }
    }
    return val;
  }, z.boolean());
}

/**
 * Strict optional integer parser for TRUST_PROXY_HOPS (`0..5`).
 * Mandatory in `production`, optional (effective `0`) in `development` / `test`.
 */
const optionalTrustProxyHops = z.preprocess((val) => {
  if (val === undefined || val === '') {
    return undefined;
  }
  if (typeof val === 'number') {
    return val;
  }
  if (typeof val === 'string' && /^-?\d+$/.test(val.trim())) {
    return Number.parseInt(val.trim(), 10);
  }
  return val;
}, z.number().int().min(0).max(5).optional());

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Reverse proxy hop count (W1-AC-08): integer 0..5, mandatory in production
    TRUST_PROXY_HOPS: optionalTrustProxyHops,

    // Database configuration (DATABASE_URL is authoritative)
    DATABASE_URL: z.string().url().optional(),
    DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(2),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),

    // Cloudflare R2 Object Storage configuration (Prompt 09 + W1-AC-09)
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET_NAME: z.string().min(1).default('kenya-education-platform-files'),
    R2_ENDPOINT: z.string().url().optional(),
    MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(52428800), // 50 MB

    // Malware Scanner configuration (W1-AC-09)
    MALWARE_SCANNER_MODE: z
      .enum(['CLAMD', 'STUB_CLEAN', 'STUB_INFECTED'])
      .optional(),
    CLAMD_HOST: z.string().min(1).optional(),
    CLAMD_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
    CLAMD_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(60000),

    // Public Canonical Domain configuration (Prompt 12 - SEO / OpenGraph)
    // Default to localhost:3000 for development and test; strictly required in production
    CANONICAL_DOMAIN: z
      .string()
      .min(1)
      .default('http://localhost:3000')
      .transform((val) => val.trim().replace(/\/+$/, '')),

    // Platform Brand / Site Name configuration (Prompt 12 - SEO / OpenGraph)
    SITE_NAME: z.string().min(1).default('ElimuPin'),

    // Authentication / Session Cookie configuration (Prompt 13)
    SESSION_COOKIE_NAME: z.string().min(1).default('session_token'),

    // Payment Simulation Guard (W1-AC-03): strictly forbidden in production
    ALLOW_PAYMENT_SIMULATION: strictEnvBoolean(false),

    // M-Pesa / Daraja Payment Gateway configuration (Prompt 19 + W1-AC-05/08)
    MPESA_ENABLED: strictEnvBoolean(false),
    MPESA_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
    MPESA_CONSUMER_KEY: z.string().optional(),
    MPESA_CONSUMER_SECRET: z.string().optional(),
    MPESA_SHORTCODE: z.string().optional(),
    MPESA_PASSKEY: z.string().optional(),
    MPESA_CALLBACK_URL: z.string().url().optional(),
    MPESA_ENABLE_LEGACY_CALLBACK_ALIAS: strictEnvBoolean(false),
  })
  .superRefine((data, ctx) => {
    // Cross-field pool range validation
    if (data.DATABASE_POOL_MIN > data.DATABASE_POOL_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DATABASE_POOL_MIN must be less than or equal to DATABASE_POOL_MAX.',
        path: ['DATABASE_POOL_MIN'],
      });
    }

    // M-Pesa configuration validation when enabled
    if (data.MPESA_ENABLED) {
      if (!data.MPESA_CONSUMER_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'MPESA_CONSUMER_KEY is required when MPESA_ENABLED is true.',
          path: ['MPESA_CONSUMER_KEY'],
        });
      }
      if (!data.MPESA_CONSUMER_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'MPESA_CONSUMER_SECRET is required when MPESA_ENABLED is true.',
          path: ['MPESA_CONSUMER_SECRET'],
        });
      }
      if (!data.MPESA_SHORTCODE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'MPESA_SHORTCODE is required when MPESA_ENABLED is true.',
          path: ['MPESA_SHORTCODE'],
        });
      }
      if (!data.MPESA_PASSKEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'MPESA_PASSKEY is required when MPESA_ENABLED is true.',
          path: ['MPESA_PASSKEY'],
        });
      }
      if (!data.MPESA_CALLBACK_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'MPESA_CALLBACK_URL is required when MPESA_ENABLED is true.',
          path: ['MPESA_CALLBACK_URL'],
        });
      }
    }

    if (data.MALWARE_SCANNER_MODE === 'CLAMD' && !data.CLAMD_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CLAMD_HOST is required when MALWARE_SCANNER_MODE is "CLAMD".',
        path: ['CLAMD_HOST'],
      });
    }

    // Production environment fail-fast security invariants (W1-AC-03, W1-AC-08, W1-AC-09)
    if (data.NODE_ENV === 'production') {
      if (data.ALLOW_PAYMENT_SIMULATION) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'In production, ALLOW_PAYMENT_SIMULATION must NEVER be true (SEC-33-01).',
          path: ['ALLOW_PAYMENT_SIMULATION'],
        });
      }

      if (data.TRUST_PROXY_HOPS === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'In production, TRUST_PROXY_HOPS is strictly required as an integer between 0 and 5.',
          path: ['TRUST_PROXY_HOPS'],
        });
      }

      if (
        !data.CANONICAL_DOMAIN ||
        data.CANONICAL_DOMAIN.includes('localhost') ||
        data.CANONICAL_DOMAIN.includes('127.0.0.1')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'In production, CANONICAL_DOMAIN must be explicitly set to a valid public URL and cannot be localhost.',
          path: ['CANONICAL_DOMAIN'],
        });
      }

      if (
        !data.R2_ACCOUNT_ID?.trim() ||
        !data.R2_ACCESS_KEY_ID?.trim() ||
        !data.R2_SECRET_ACCESS_KEY?.trim()
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'In production, Cloudflare R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) are strictly required; MemoryStorageProvider fallback is forbidden.',
          path: ['R2_ACCOUNT_ID'],
        });
      }

      if (data.MALWARE_SCANNER_MODE !== 'CLAMD') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'In production, MALWARE_SCANNER_MODE must be explicitly set to "CLAMD"; stub scanners are forbidden.',
          path: ['MALWARE_SCANNER_MODE'],
        });
      } else if (!data.CLAMD_HOST?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'In production, CLAMD_HOST is strictly required when MALWARE_SCANNER_MODE="CLAMD".',
          path: ['CLAMD_HOST'],
        });
      }

      if (data.MPESA_ENABLED && data.MPESA_ENVIRONMENT !== 'production') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'In production, MPESA_ENVIRONMENT must be "production" when MPESA_ENABLED is true.',
          path: ['MPESA_ENVIRONMENT'],
        });
      }

      if (!data.DATABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DATABASE_URL is strictly required when NODE_ENV is "production".',
          path: ['DATABASE_URL'],
        });
        return;
      }

      // Production SSL requirement: DATABASE_URL must explicitly specify an acceptable secure SSL mode
      try {
        const parsedUrl = new URL(data.DATABASE_URL);
        const sslmode = parsedUrl.searchParams.get('sslmode');

        if (!sslmode) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'In production, DATABASE_URL must explicitly specify an sslmode parameter (e.g. ?sslmode=require, ?sslmode=verify-ca, or ?sslmode=verify-full).',
            path: ['DATABASE_URL'],
          });
        } else if (!ACCEPTABLE_PRODUCTION_SSL_MODES.includes(sslmode.toLowerCase())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `In production, DATABASE_URL specifies unencrypted or insecure sslmode="${sslmode}". Must be one of: ${ACCEPTABLE_PRODUCTION_SSL_MODES.join(', ')}.`,
            path: ['DATABASE_URL'],
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DATABASE_URL must be a valid PostgreSQL connection URI.',
          path: ['DATABASE_URL'],
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.format());
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
