import React from 'react';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-lg focus:bg-[var(--accent-primary)] focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-[var(--text-on-accent)] focus:outline-2 focus:outline-offset-2 focus:outline-[var(--focus-ring)]"
      >
        Skip to main content
      </a>

      <SiteHeader />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-10 sm:px-6 lg:px-8 focus:outline-none"
      >
        {children}
      </main>

      <SiteFooter />
    </div>
  );
}
