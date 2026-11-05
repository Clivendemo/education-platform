'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { type CsrfManager, getDefaultCsrfManager } from '@/lib/api/csrf-manager';

export interface SessionCsrfContextValue {
  csrfEpoch: number;
  hasActiveToken: boolean;
  lastRotatedAtMs: number | null;
  csrfManager: CsrfManager;
}

const SessionCsrfContext = createContext<SessionCsrfContextValue | null>(null);

export function SessionCsrfProvider({
  children,
  manager,
}: {
  children: React.ReactNode;
  manager?: CsrfManager;
}) {
  const activeManager = useMemo(() => manager ?? getDefaultCsrfManager(), [manager]);
  const [snapshot, setSnapshot] = useState(() => ({
    csrfEpoch: activeManager.getEpoch(),
    hasActiveToken: activeManager.peekToken() !== null,
    lastRotatedAtMs: null as number | null,
  }));

  useEffect(() => {
    const unsubscribe = activeManager.subscribe((next) => {
      setSnapshot({
        csrfEpoch: next.csrfEpoch,
        hasActiveToken: next.hasToken,
        lastRotatedAtMs: next.lastRotatedAtMs,
      });
    });
    return unsubscribe;
  }, [activeManager]);

  const value = useMemo<SessionCsrfContextValue>(
    () => ({
      csrfEpoch: snapshot.csrfEpoch,
      hasActiveToken: snapshot.hasActiveToken,
      lastRotatedAtMs: snapshot.lastRotatedAtMs,
      csrfManager: activeManager,
    }),
    [snapshot, activeManager],
  );

  return <SessionCsrfContext.Provider value={value}>{children}</SessionCsrfContext.Provider>;
}

export function useSessionCsrf(): SessionCsrfContextValue {
  const ctx = useContext(SessionCsrfContext);
  if (!ctx) {
    throw new Error('useSessionCsrf must be used within a SessionCsrfProvider');
  }
  return ctx;
}
