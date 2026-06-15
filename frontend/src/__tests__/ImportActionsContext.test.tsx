/**
 * ImportActionsContext Tests
 *
 * Spec 2026-01-22: No-Database Mode Empty-State UX
 * Task Group 6: ImportActionsContext Creation
 *
 * Tests cover:
 * 1. Context throws error when used outside provider
 * 2. triggerImportJson is callable from context
 * 3. triggerImportXlsx is callable from context
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import {
  ImportActionsProvider,
  useImportActions,
} from '../contexts/ImportActionsContext';

describe('ImportActionsContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Task 6.1 Test 1: Context throws error when used outside provider', () => {
    it('should throw error when useImportActions is used outside ImportActionsProvider', () => {
      // Suppress console.error for this test since we expect an error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const TestComponent = () => {
        useImportActions();
        return <div>Test</div>;
      };

      expect(() => render(<TestComponent />)).toThrow(
        'useImportActions must be used within an ImportActionsProvider'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Task 6.1 Test 2: triggerImportJson is callable from context', () => {
    it('should call triggerImportJson when invoked', () => {
      const mockTriggerImportJson = vi.fn();
      const mockTriggerImportXlsx = vi.fn();

      const TestComponent = () => {
        const { triggerImportJson } = useImportActions();
        return (
          <button onClick={triggerImportJson} data-testid="import-json-btn">
            Import JSON
          </button>
        );
      };

      render(
        <ImportActionsProvider
          triggerImportJson={mockTriggerImportJson}
          triggerImportXlsx={mockTriggerImportXlsx}
        >
          <TestComponent />
        </ImportActionsProvider>
      );

      const button = screen.getByTestId('import-json-btn');
      fireEvent.click(button);

      expect(mockTriggerImportJson).toHaveBeenCalledTimes(1);
    });
  });

  describe('Task 6.1 Test 3: triggerImportXlsx is callable from context', () => {
    it('should call triggerImportXlsx when invoked', () => {
      const mockTriggerImportJson = vi.fn();
      const mockTriggerImportXlsx = vi.fn();

      const TestComponent = () => {
        const { triggerImportXlsx } = useImportActions();
        return (
          <button onClick={triggerImportXlsx} data-testid="import-xlsx-btn">
            Import XLSX
          </button>
        );
      };

      render(
        <ImportActionsProvider
          triggerImportJson={mockTriggerImportJson}
          triggerImportXlsx={mockTriggerImportXlsx}
        >
          <TestComponent />
        </ImportActionsProvider>
      );

      const button = screen.getByTestId('import-xlsx-btn');
      fireEvent.click(button);

      expect(mockTriggerImportXlsx).toHaveBeenCalledTimes(1);
    });
  });
});
