import React from 'react';
import { ElimuPinLogo } from '@/components/brand/elimupin-logo';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-[var(--border-hairline)] bg-[var(--bg-surface)]">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-10 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="space-y-2">
          <ElimuPinLogo />
          <p className="max-w-xl text-sm text-[var(--text-secondary)]">
            Curriculum-aligned learning infrastructure for Kenyan educators across Competency-Based
            Curriculum (CBC) and 8-4-4 classrooms.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-[var(--text-muted)]">
          <span>Kenya Country Baseline (KE)</span>
          <span>Commercial-Safe Curated Media Policy</span>
          <span className="font-mono-tabular">&copy; 2026 ElimuPin</span>
        </div>
      </div>
    </footer>
  );
}
