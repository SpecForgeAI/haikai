/**
 * ContractFileUploadInput (2026-08-02) — the service-discovery contract
 * upload picker. Pins: accepts WADL/WSDL/XSD, rejects other extensions with a
 * visible reason, and emits the selection via onChange.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContractFileUploadInput } from './ContractFileUploadInput';

function makeFile(name: string, bytes = 32): File {
  return new File(['x'.repeat(bytes)], name, { type: 'application/xml' });
}

describe('ContractFileUploadInput', () => {
  it('accepts a .wadl file and emits it via onChange', () => {
    const onChange = vi.fn();
    render(<ContractFileUploadInput selectedFiles={[]} onChange={onChange} />);
    const input = screen.getByTestId('contract-file-upload-input-file-input');
    fireEvent.change(input, { target: { files: [makeFile('views.wadl')] } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].map((f: File) => f.name)).toEqual(['views.wadl']);
  });

  it('rejects a non-contract extension with a visible reason and does NOT emit', () => {
    const onChange = vi.fn();
    render(<ContractFileUploadInput selectedFiles={[]} onChange={onChange} />);
    const input = screen.getByTestId('contract-file-upload-input-file-input');
    fireEvent.change(input, { target: { files: [makeFile('notes.txt')] } });
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('contract-file-upload-input-validation-errors').textContent,
    ).toContain('unsupported extension');
  });

  it('lists selected files with a remove control', () => {
    const onChange = vi.fn();
    render(
      <ContractFileUploadInput selectedFiles={[makeFile('a.xsd')]} onChange={onChange} />,
    );
    expect(screen.getByTestId('contract-file-upload-input-row-0')).toHaveTextContent('a.xsd');
    fireEvent.click(screen.getByTestId('contract-file-upload-input-remove-0'));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
