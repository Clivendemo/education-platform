import React from 'react';

export type StatusTone = 'ok' | 'info' | 'warn' | 'error';

export interface StatusNoticeProps {
  tone: StatusTone;
  title: string;
  children?: React.ReactNode;
  className?: string;
}

const TONE_STYLES: Record<StatusTone, { wrapper: string; prefix: string }> = {
  ok: {
    wrapper:
      'bg-[var(--status-ok-bg)] border-[var(--status-ok-border)] text-[var(--status-ok-text)]',
    prefix: 'Verified',
  },
  info: {
    wrapper:
      'bg-[var(--status-info-bg)] border-[var(--status-info-border)] text-[var(--status-info-text)]',
    prefix: 'Note',
  },
  warn: {
    wrapper:
      'bg-[var(--status-warn-bg)] border-[var(--status-warn-border)] text-[var(--status-warn-text)]',
    prefix: 'Attention',
  },
  error: {
    wrapper:
      'bg-[var(--status-error-bg)] border-[var(--status-error-border)] text-[var(--status-error-text)]',
    prefix: 'Action required',
  },
};

export function StatusNotice({ tone, title, children, className = '' }: StatusNoticeProps) {
  const config = TONE_STYLES[tone];
  const role = tone === 'error' || tone === 'warn' ? 'alert' : 'status';

  return (
    <div
      role={role}
      className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${config.wrapper} ${className}`.trim()}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
        className="mt-0.5 shrink-0"
      >
        {tone === 'ok' ? (
          <path
            d="M16.25 6.25L8.125 14.375L3.75 10"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <>
            <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="M10 6.5V10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="10" cy="13.5" r="1" fill="currentColor" />
          </>
        )}
      </svg>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold leading-snug">
          <span>{config.prefix}: </span>
          {title}
        </p>
        {children ? <div className="leading-relaxed opacity-95">{children}</div> : null}
      </div>
    </div>
  );
}
