import React from 'react';

export interface ElimuPinLogoProps {
  className?: string;
  showWordmark?: boolean;
}

export function ElimuPinLogo({ className = '', showWordmark = true }: ElimuPinLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 shrink-0 whitespace-nowrap ${className}`.trim()}>
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
        className="shrink-0"
      >
        <rect
          x="1.5"
          y="1.5"
          width="25"
          height="25"
          rx="6"
          fill="var(--accent-primary)"
        />
        <path
          d="M8.5 9.5H19.5M8.5 14H16.5M8.5 18.5H19.5"
          stroke="#FFFFFF"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="19.5" cy="14" r="2" fill="#FDBA74" />
      </svg>
      {showWordmark ? (
        <span className="text-lg font-bold tracking-tight text-[var(--text-primary)] whitespace-nowrap">
          ElimuPin
        </span>
      ) : null}
    </span>
  );
}
