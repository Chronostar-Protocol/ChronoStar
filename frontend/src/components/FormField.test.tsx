import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React, { createRef } from 'react';
import { FormField } from './FormField';

afterEach(() => {
  cleanup();
});

describe('FormField component accessibility', () => {
  it('associates label with input using htmlFor and id for accessible name', () => {
    render(
      <FormField
        id="test-field"
        label="Test Field Label"
        placeholder="Enter test value"
        value=""
        onChange={() => {}}
      />
    );

    const input = screen.getByLabelText('Test Field Label');
    expect(input).toBeDefined();
    expect(input.id).toBe('test-field');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });

  it('links error message to input via aria-describedby and marks aria-invalid', () => {
    render(
      <FormField
        id="test-field-error"
        label="Token Address"
        value=""
        error="Token address is required"
        onChange={() => {}}
      />
    );

    const input = screen.getByLabelText('Token Address');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('test-field-error-error');

    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    expect(alert.id).toBe('test-field-error-error');
    expect(alert.textContent).toBe('Token address is required');
  });

  it('forwards ref correctly to the underlying input element', () => {
    const inputRef = createRef<HTMLInputElement>();
    render(
      <FormField
        ref={inputRef}
        id="ref-field"
        label="Ref Field"
        value=""
        onChange={() => {}}
      />
    );

    expect(inputRef.current).toBeInstanceOf(HTMLInputElement);
    expect(inputRef.current?.id).toBe('ref-field');
  });

  it('displays character counter when showCounter and maxLength are provided', () => {
    render(
      <FormField
        id="counter-field"
        label="Description"
        value="Hello"
        maxLength={64}
        showCounter
        onChange={() => {}}
      />
    );

    expect(screen.getByText('5/64')).toBeDefined();
  });
});
