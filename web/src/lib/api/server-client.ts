import 'server-only';
import { publicEnv } from '@/config/public-env';
import { getServerEnv } from '@/config/server-env';
import type {
  ApiSuccessEnvelope,
  HealthStatusDto,
  PlatformReadinessSnapshot,
} from './types';

const DEFAULT_INTERNAL_TIMEOUT_MS = 2500;

/**
 * Server Component internal API client (`GHSA-vc7v-qv4w-wrv8` defense-in-depth):
 * - Calls internal Fastify origin via `FASTIFY_INTERNAL_URL`.
 * - Parses and returns plain serializable DTOs only; NEVER returns raw upstream `Response` instances.
 */
export async function fetchBackendHealthSnapshot(options?: {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<PlatformReadinessSnapshot> {
  const { FASTIFY_INTERNAL_URL } = getServerEnv();
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_INTERNAL_TIMEOUT_MS;

  try {
    const response = await fetchFn(`${FASTIFY_INTERNAL_URL}/api/v1/health`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return {
        reachable: false,
        status: 'unavailable',
        checkedAtIso: new Date().toISOString(),
        countryCode: publicEnv.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE,
      };
    }

    const payload = (await response.json()) as ApiSuccessEnvelope<HealthStatusDto>;
    const ok = payload?.data?.status === 'ok';
    return {
      reachable: ok,
      status: ok ? 'ok' : 'unavailable',
      checkedAtIso: payload?.data?.timestamp ?? new Date().toISOString(),
      countryCode: publicEnv.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE,
    };
  } catch {
    return {
      reachable: false,
      status: 'unavailable',
      checkedAtIso: new Date().toISOString(),
      countryCode: publicEnv.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE,
    };
  }
}
