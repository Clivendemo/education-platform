'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { ElimuPinLogo } from '@/components/brand/elimupin-logo';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/providers/theme-provider';

const PRIMARY_NAV_ITEMS = [
  { href: '#search', label: 'Search' },
  { href: '#pillars', label: 'Curriculum Pillars' },
  { href: '#trending', label: 'Trending' },
  { href: '#updates', label: 'Updates' },
  { href: '#calendar', label: 'Calendar' },
] as const;

export function SiteHeader() {
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)]/95 backdrop-blur-xs">
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Brand mark */}
        <Link
          href="/"
          aria-label="ElimuPin home"
          className="inline-flex min-h-11 items-center rounded-lg px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          <ElimuPinLogo />
        </Link>

        {/* Zone 2: Primary navigation (4 single-line links, zero wrap) */}
        <nav aria-label="Primary navigation" className="hidden md:flex md:items-center md:gap-2">
          {PRIMARY_NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="inline-flex min-h-11 items-center rounded-lg px-3.5 text-sm font-medium whitespace-nowrap shrink-0 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Zone 3: Theme & mobile drawer controls */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </Button>

          <Button
            variant="ghost"
            className="md:hidden"
            aria-expanded={mobileOpen}
            aria-controls="mobile-site-nav"
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            onClick={() => setMobileOpen((prev) => !prev)}
          >
            Menu
          </Button>
        </div>
      </div>

      {mobileOpen ? (
        <nav
          id="mobile-site-nav"
          aria-label="Mobile navigation"
          className="border-t border-[var(--border-hairline)] bg-[var(--bg-surface)] px-4 py-3 md:hidden"
        >
          <ul className="flex flex-col gap-1">
            {PRIMARY_NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
