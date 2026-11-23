import React, { forwardRef } from 'react';

export interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
  testid?: string;
  showCounter?: boolean;
  accentColor?: 'blue' | 'green' | 'orange';
}

export const FormField = forwardRef<HTMLInputElement, FormFieldProps>(function FormField(
  {
    id,
    label,
    error,
    testid,
    showCounter,
    accentColor = 'blue',
    type = 'text',
    value,
    className = '',
    maxLength,
    ...rest
  },
  ref
) {
  const errorId = error ? `${id}-error` : undefined;
  const currentLength =
    typeof value === 'string' || typeof value === 'number' ? String(value).length : 0;

  const accentBorderClass =
    accentColor === 'green'
      ? 'focus:border-accent-green'
      : accentColor === 'orange'
      ? 'focus:border-accent-orange'
      : 'focus:border-accent-blue';

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1">
        <label htmlFor={id} className="block text-sm text-text-muted">
          {label}
        </label>
        {showCounter && maxLength !== undefined && (
          <span className="text-xs text-text-muted">
            {currentLength}/{maxLength}
          </span>
        )}
      </div>
      <input
        ref={ref}
        id={id}
        data-testid={testid}
        type={type}
        value={value}
        maxLength={maxLength}
        aria-invalid={Boolean(error)}
        aria-describedby={errorId}
        className={`w-full px-3 py-2 rounded-lg border ${
          error ? 'border-accent-red' : 'border-border'
        } bg-bg-card text-text-primary placeholder:text-text-muted/50 focus:outline-none ${accentBorderClass} transition-colors ${className}`}
        {...rest}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-accent-red mt-1">
          {error}
        </p>
      )}
    </div>
  );
});
