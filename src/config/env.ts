import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file if available (allowing .env overrides)
dotenv.config({ override: true });

const ACCEPTABLE_PRODUCTION_SSL_MODES = ['require', 'verify-ca', 'verify-full'];

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Database configuration (DATABASE_URL is authoritative)
    DATABASE_URL: z.string().url().optional(),
    DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(2),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),

    // Cloudflare R2 Object Storage configuration (Prompt 09)
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET_NAME: z.string().min(1).default('kenya-education-platform-files'),
    R2_ENDPOINT: z.string().url().optional(),
    MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(52428800), // 50 MB

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

    // M-Pesa / Daraja Payment Gateway configuration (Prompt 19)
    MPESA_ENABLED: z.coerce.boolean().default(false),
    MPESA_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
    MPESA_CONSUMER_KEY: z.string().optional(),
    MPESA_CONSUMER_SECRET: z.string().optional(),
    MPESA_SHORTCODE: z.string().optional(),
    MPESA_PASSKEY: z.string().optional(),
    MPESA_CALLBACK_URL: z.string().url().optional(),
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

    // Production environment requirements
    if (data.NODE_ENV === 'production') {
      // In production, when CANONICAL_DOMAIN is provided or in active production runtime, it must not be localhost
      if (process.env.NODE_ENV === 'production' && (!data.CANONICAL_DOMAIN || data.CANONICAL_DOMAIN.includes('localhost') || data.CANONICAL_DOMAIN.includes('127.0.0.1'))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'In production, CANONICAL_DOMAIN must be explicitly set to a valid public URL and cannot be localhost.',
          path: ['CANONICAL_DOMAIN'],
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
