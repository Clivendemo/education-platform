import 'server-only';

import React from 'react';
import { getServerEnv } from '@/config/server-env';
import { StatusNotice } from '@/components/ui/status-notice';
import type {
  PublicHomepagePayload,
  PublicHomepageResponse,
  ResourceTypeResult,
} from '@/lib/api/types';
import { HeroSection } from './hero-section';
import { PillarGrid } from './pillar-grid';
import { SlotSectionRenderer } from './slot-section-renderer';

interface InternalFetchResult<T> {
  data: T | null;
  error: string | null;
}

async function fetchKenyaHomepageData(): Promise<
  InternalFetchResult<PublicHomepagePayload>
> {
  const { FASTIFY_INTERNAL_URL } = getServerEnv();
  try {
    const res = await fetch(`${FASTIFY_INTERNAL_URL}/api/v1/homepage?country=ke`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(3500),
    });

    if (!res.ok) {
      return { data: null, error: `HTTP ${res.status}` };
    }

    const payload = (await res.json()) as PublicHomepageResponse;
    return { data: payload.data, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Connection failed';
    return { data: null, error: message };
  }
}

async function fetchActiveResourceTypes(): Promise<ResourceTypeResult[]> {
  const { FASTIFY_INTERNAL_URL } = getServerEnv();
  try {
    const res = await fetch(
      `${FASTIFY_INTERNAL_URL}/api/v1/resource-types?includeInactive=false`,
      {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(3500),
      },
    );

    if (!res.ok) return [];

    const payload = (await res.json()) as { data: ResourceTypeResult[] };
    return payload.data || [];
  } catch {
    return [];
  }
}

export async function KenyaHomepage() {
  const [homepageResult, resourceTypes] = await Promise.all([
    fetchKenyaHomepageData(),
    fetchActiveResourceTypes(),
  ]);

  const hasData = homepageResult.data !== null;

  return (
    <div className="space-y-16">
      {/* Zone 1: Hero Section with Integrated Search */}
      <HeroSection country="ke" />

      {/* Zone 2: 8 Canonical Content Pillars */}
      <PillarGrid resourceTypes={resourceTypes} />

      {/* Zone 3: 6 Canonical Dynamic Homepage Slots OR Honest Degraded State */}
      {hasData ? (
        <SlotSectionRenderer sections={homepageResult.data.sections} />
      ) : (
        <section
          id="trending"
          aria-labelledby="degraded-heading"
          className="space-y-4"
        >
          <h2
            id="degraded-heading"
            className="text-2xl font-bold tracking-tight text-[var(--text-primary)]"
          >
            Curriculum Resources &amp; Updates
          </h2>
          <StatusNotice
            tone="info"
            title="Educational resources temporarily unavailable"
          >
            Some educational resources and updates are temporarily unavailable. Search
            and navigation remain active while we reconnect to the resource service.
          </StatusNotice>
        </section>
      )}
    </div>
  );
}
