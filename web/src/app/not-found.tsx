import Link from 'next/link';
import React from 'react';
import { SurfaceCard } from '@/components/ui/surface-card';

export default function NotFoundPage() {
  return (
    <SurfaceCard className="mx-auto max-w-xl space-y-4">
      <p className="font-mono-tabular text-xs font-semibold text-[var(--text-muted)]">
        HTTP 404
      </p>
      <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
        Page not found
      </h1>
      <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
        The curriculum page or resource address you requested does not exist or has moved.
      </p>
      <div className="pt-2">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--accent-primary)] px-4 py-2.5 text-sm font-semibold whitespace-nowrap text-[var(--text-on-accent)] hover:bg-[var(--accent-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          Back to ElimuPin home
        </Link>
      </div>
    </SurfaceCard>
  );
}
