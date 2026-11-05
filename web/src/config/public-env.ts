import { z } from 'zod';

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().trim().min(1).max(64).default('ElimuPin'),
  NEXT_PUBLIC_DEFAULT_COUNTRY_CODE: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/, 'Country code must be an uppercase ISO 3166-1 alpha-2 code')
    .default('KE'),
  NEXT_PUBLIC_API_BASE_PATH: z
    .string()
    .trim()
    .refine(
      (val) => val === '/api/v1' || val.startsWith('/api/v1/'),
      'NEXT_PUBLIC_API_BASE_PATH must begin with /api/v1',
    )
    .transform((val) => val.replace(/\/+$/, ''))
    .default('/api/v1'),
});

export type PublicEnv = z.infer<typeof PublicEnvSchema>;

export function parsePublicEnv(raw: Record<string, string | undefined>): PublicEnv {
  return PublicEnvSchema.parse({
    NEXT_PUBLIC_APP_NAME: raw.NEXT_PUBLIC_APP_NAME || undefined,
    NEXT_PUBLIC_DEFAULT_COUNTRY_CODE: raw.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE || undefined,
    NEXT_PUBLIC_API_BASE_PATH: raw.NEXT_PUBLIC_API_BASE_PATH || undefined,
  });
}

export const publicEnv: PublicEnv = parsePublicEnv({
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_DEFAULT_COUNTRY_CODE: process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE,
  NEXT_PUBLIC_API_BASE_PATH: process.env.NEXT_PUBLIC_API_BASE_PATH,
});
