import React from 'react';

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-start justify-between gap-4 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-subtle)] p-6 ${className}`.trim()}
    >
      <div className="space-y-2">
        {icon ? (
          <div aria-hidden="true" className="text-[var(--text-muted)]">
            {icon}
          </div>
        ) : null}
        <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
        <p className="max-w-prose text-sm leading-relaxed text-[var(--text-secondary)]">
          {description}
        </p>
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
