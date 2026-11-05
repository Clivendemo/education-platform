import React from 'react';

export interface SurfaceCardProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const PADDING_CLASSES: Record<NonNullable<SurfaceCardProps['padding']>, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

export function SurfaceCard({
  as: Component = 'div',
  padding = 'md',
  className = '',
  children,
  ...rest
}: SurfaceCardProps) {
  return (
    <Component
      className={`rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] ${PADDING_CLASSES[padding]} ${className}`.trim()}
      {...rest}
    >
      {children}
    </Component>
  );
}
