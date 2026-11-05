import 'server-only';
import { z } from 'zod';

const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FASTIFY_INTERNAL_URL: z
    .string()
    .trim()
    .url('FASTIFY_INTERNAL_URL must be a valid URL')
    .refine((val) => {
      const parsed = new URL(val);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    }, 'FASTIFY_INTERNAL_URL must use http: or https: protocol')
    .transform((val) => val.replace(/\/+$/, ''))
    .default('http://127.0.0.1:3000'),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export function getServerEnv(envMap: NodeJS.ProcessEnv = process.env): ServerEnv {
  return ServerEnvSchema.parse({
    NODE_ENV: envMap.NODE_ENV || undefined,
    FASTIFY_INTERNAL_URL: envMap.FASTIFY_INTERNAL_URL || undefined,
  });
}
