/**
 * NoProjectEmptyState Component Tests
 *
 * Spec 2026-01-22: No-Database Mode Empty-State UX
 * Task Group 1: NoProjectEmptyState Component
 *
 * Tests cover:
 * 1. Renders "No project loaded" heading
 * 2. Renders "Import a project snapshot to begin working." sub-text
 * 3. Calls `onImportJson` when "Import JSON" button clicked
 * 4. Calls `onImportXlsx` when "Import XLSX" button clicked
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { NoProjectEmptyState } from '../components/EmptyState/NoProjectEmptyState';

describe('NoProjectEmptyState Component', () => {
  const mockOnImportJson = vi.fn();
  const mockOnImportXlsx = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Task 1.1 Test 1: Renders "No project loaded" heading', () => {
    it('should render the heading text', () => {
      render(
        <NoProjectEmptyState
          onImportJson={mockOnImportJson}
          onImportXlsx={mockOnImportXlsx}
        />
      );

      expect(screen.getByTestId('empty-state-heading')).toHaveTextContent('No product loaded');
    });
  });

  describe('Task 1.1 Test 2: Renders "Import a project snapshot to begin working." sub-text', () => {
    it('should render the sub-text', () => {
      render(
        <NoProjectEmptyState
          onImportJson={mockOnImportJson}
          onImportXlsx={mockOnImportXlsx}
        />
      );

      expect(screen.getByTestId('empty-state-subtext')).toHaveTextContent(
        'Import a product snapshot to begin working.'
      );
    });
  });

  describe('Task 1.1 Test 3: Calls `onImportJson` when "Import JSON" button clicked', () => {
    it('should call onImportJson when Import JSON button is clicked', () => {
      render(
        <NoProjectEmptyState
          onImportJson={mockOnImportJson}
          onImportXlsx={mockOnImportXlsx}
        />
      );

      const importJsonButton = screen.getByTestId('import-json-button');
      fireEvent.click(importJsonButton);

      expect(mockOnImportJson).toHaveBeenCalledTimes(1);
    });

    it('should have correct aria-label for accessibility', () => {
      render(
        <NoProjectEmptyState
          onImportJson={mockOnImportJson}
          onImportXlsx={mockOnImportXlsx}
        />
      );

      const importJsonButton = screen.getByTestId('import-json-button');
      expect(importJsonButton).toHaveAttribute('aria-label', 'Import product from JSON file');
    });
  });

  describe('Task 1.1 Test 4: Calls `onImportXlsx` when "Import XLSX" button clicked', () => {
    it('should call onImportXlsx when Import XLSX button is clicked', () => {
      render(
        <NoProjectEmptyState
          onImportJson={mockOnImportJson}
          onImportXlsx={mockOnImportXlsx}
        />
      );

      const importXlsxButton = screen.getByTestId('import-xlsx-button');
      fireEvent.click(importXlsxButton);

      expect(mockOnImportXlsx).toHaveBeenCalledTimes(1);
    });

    it('should have correct aria-label for accessibility', () => {
      render(
        <NoProjectEmptyState
          onImportJson={mockOnImportJson}
          onImportXlsx={mockOnImportXlsx}
        />
      );

      const importXlsxButton = screen.getByTestId('import-xlsx-button');
      expect(importXlsxButton).toHaveAttribute('aria-label', 'Import product from Excel file');
    });
  });

  describe('Container and layout', () => {
    it('should render container with correct test id', () => {
      render(
        <NoProjectEmptyState
          onImportJson={mockOnImportJson}
          onImportXlsx={mockOnImportXlsx}
        />
      );

      expect(screen.getByTestId('no-project-empty-state')).toBeInTheDocument();
    });
  });
});
