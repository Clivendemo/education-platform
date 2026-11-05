'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { StatusNotice } from '@/components/ui/status-notice';
import { SurfaceCard } from '@/components/ui/surface-card';

export default function GlobalRouteError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SurfaceCard className="mx-auto max-w-xl space-y-5">
      <h1 className="text-xl font-bold text-[var(--text-primary)]">
        Unable to load this view
      </h1>
      <StatusNotice tone="error" title="An unexpected page error occurred">
        Your session data remains intact. You can retry loading this section or return to the
        ElimuPin home screen.
      </StatusNotice>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => reset()}>
          Try again
        </Button>
        <a
          href="/"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-2.5 text-sm font-semibold whitespace-nowrap text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          Return home
        </a>
      </div>
    </SurfaceCard>
  );
}
