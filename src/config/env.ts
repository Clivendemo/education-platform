import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file if available
dotenv.config();

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

    // Production environment requirements
    if (data.NODE_ENV === 'production') {
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
