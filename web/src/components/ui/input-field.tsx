import React, { useId } from 'react';

export interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  helperText?: string;
  errorMessage?: string;
}

export const InputField = React.forwardRef<HTMLInputElement, InputFieldProps>(function InputField(
  { label, helperText, errorMessage, id, className = '', ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? `field-${generatedId}`;
  const helperId = helperText ? `${inputId}-helper` : undefined;
  const errorId = errorMessage ? `${inputId}-error` : undefined;
  const describedBy = [errorId, helperId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-sm font-medium text-[var(--text-primary)]"
      >
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={errorMessage ? true : undefined}
        aria-describedby={describedBy}
        className={`min-h-11 w-full rounded-lg border bg-[var(--bg-surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] ${
          errorMessage
            ? 'border-[var(--status-error-border)]'
            : 'border-[var(--border-strong)]'
        } ${className}`.trim()}
        {...rest}
      />
      {helperText && !errorMessage ? (
        <p id={helperId} className="text-xs text-[var(--text-muted)]">
          {helperText}
        </p>
      ) : null}
      {errorMessage ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-[var(--status-error-text)]">
          Error: {errorMessage}
        </p>
      ) : null}
    </div>
  );
});
