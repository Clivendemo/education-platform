'use client';

import React from 'react';
import { SessionCsrfProvider } from './session-csrf-provider';
import { ThemeProvider } from './theme-provider';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SessionCsrfProvider>{children}</SessionCsrfProvider>
    </ThemeProvider>
  );
}
