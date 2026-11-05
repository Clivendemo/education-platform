import React from 'react';
import { ElimuPinLogo } from '@/components/brand/elimupin-logo';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-[var(--border-hairline)] bg-[var(--bg-surface)]">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
          <div className="space-y-3 md:col-span-6">
            <ElimuPinLogo />
            <p className="max-w-md text-sm leading-relaxed text-[var(--text-secondary)]">
              Curriculum-aligned learning infrastructure for Kenyan educators across
              Competency-Based Curriculum (CBC) and 8-4-4 classrooms.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6 md:col-span-6 sm:grid-cols-3">
            <div className="space-y-2">
              <p className="text-xs font-semibold tracking-wider uppercase text-[var(--text-primary)]">
                Curriculum
              </p>
              <ul className="space-y-1.5 text-xs text-[var(--text-secondary)]">
                <li>
                  <a href="#pillars" className="hover:text-[var(--text-primary)] transition-colors">
                    8 Content Pillars
                  </a>
                </li>
                <li>
                  <a href="#trending" className="hover:text-[var(--text-primary)] transition-colors">
                    CBC &amp; KCSE Materials
                  </a>
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold tracking-wider uppercase text-[var(--text-primary)]">
                Notices
              </p>
              <ul className="space-y-1.5 text-xs text-[var(--text-secondary)]">
                <li>
                  <a href="#updates" className="hover:text-[var(--text-primary)] transition-colors">
                    Education Updates
                  </a>
                </li>
                <li>
                  <a href="#calendar" className="hover:text-[var(--text-primary)] transition-colors">
                    Academic Calendar
                  </a>
                </li>
              </ul>
            </div>

            <div className="space-y-2 col-span-2 sm:col-span-1">
              <p className="text-xs font-semibold tracking-wider uppercase text-[var(--text-primary)]">
                Standards
              </p>
              <ul className="space-y-1.5 text-xs text-[var(--text-secondary)]">
                <li>Kenya Baseline (KE)</li>
                <li>Commercial-Safe Media</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border-hairline)] pt-6 text-xs text-[var(--text-muted)]">
          <span>Kenya National Curriculum Platform</span>
          <span className="font-mono-tabular">&copy; 2026 ElimuPin</span>
        </div>
      </div>
    </footer>
  );
}
