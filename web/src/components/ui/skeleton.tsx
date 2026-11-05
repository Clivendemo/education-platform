import React from 'react';

export interface SkeletonProps {
  className?: string;
  label?: string;
}

export function Skeleton({ className = 'h-6 w-full', label = 'Loading content' }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className={`animate-pulse motion-reduce:animate-none rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-hairline)] ${className}`.trim()}
    />
  );
}
