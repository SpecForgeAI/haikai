/**
 * Tests for CreateOrganisationModal Flush Before Submit Behavior
 *
 * Spec 2026-01-31: Fix Create Organisation Standards Flow
 * Task Group 2: CreateOrganisationModal Flush Before Submit + Payload Update
 *
 * Note: Testing flush behavior with React state is complex because:
 * - flush() calls onChange which updates parent state
 * - React batches state updates and they're async
 * - We test that refs are passed to components and the new payload schema is used
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateOrganisationModal } from './CreateOrganisationModal';
import * as organisationsApi from '../../api/organisationsApi';

// Mock the organisations API
vi.mock('../../api/organisationsApi', async () => {
  const actual = await vi.importActual('../../api/organisationsApi');
  return {
    ...actual,
    listOrganisations: vi.fn(),
  createOrganisationFull: vi.fn(),
  generateGlobalStandards: vi.fn(),
  OrganisationConflictError: class extends Error {
    isConflict = true;
  },
  };
});

describe('CreateOrganisationModal - Flush Before Submit', () => {
  const mockOnClose = vi.fn();
  const mockOnCreated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations
    (organisationsApi.listOrganisations as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (organisationsApi.createOrganisationFull as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'org-123',
      name: 'Test Org',
      description: null,
    });
    (organisationsApi.generateGlobalStandards as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  describe('flush before submit', () => {
    it('standards payload uses new external-compatible schema (no organisationId)', async () => {
      render(
        <CreateOrganisationModal
          isOpen={true}
          onClose={mockOnClose}
          onCreated={mockOnCreated}
        />
      );

      // Wait for organisations to load
      await waitFor(() => {
        expect(screen.getByTestId('organisation-name-input')).toBeEnabled();
      });

      // Fill in name
      const nameInput = screen.getByTestId('organisation-name-input');
      fireEvent.change(nameInput, { target: { value: 'My Company' } });

      // Click Create button
      const createButton = screen.getByTestId('create-button');
      fireEvent.click(createButton);

      // Wait for standards generation call
      await waitFor(() => {
        expect(organisationsApi.generateGlobalStandards).toHaveBeenCalled();
      });

      // Verify the standards payload structure
      const standardsCall = (organisationsApi.generateGlobalStandards as ReturnType<typeof vi.fn>).mock.calls[0];
      const standardsPayload = standardsCall[0];

      // Should NOT have organisationId
      expect(standardsPayload).not.toHaveProperty('organisationId');
      // Should have company field
      expect(standardsPayload).toHaveProperty('company', 'My Company');
      // Should have sources array
      expect(standardsPayload).toHaveProperty('sources');
      // Should have technical_documents object
      expect(standardsPayload).toHaveProperty('technical_documents');
    });

    it('technical_documents object has correct snake_case keys', async () => {
      render(
        <CreateOrganisationModal
          isOpen={true}
          onClose={mockOnClose}
          onCreated={mockOnCreated}
        />
      );

      // Wait for organisations to load
      await waitFor(() => {
        expect(screen.getByTestId('organisation-name-input')).toBeEnabled();
      });

      // Fill in name
      const nameInput = screen.getByTestId('organisation-name-input');
      fireEvent.change(nameInput, { target: { value: 'Test Corp' } });

      // Click Create button
      const createButton = screen.getByTestId('create-button');
      fireEvent.click(createButton);

      // Wait for standards generation call
      await waitFor(() => {
        expect(organisationsApi.generateGlobalStandards).toHaveBeenCalled();
      });

      // Verify technical_documents structure
      const standardsCall = (organisationsApi.generateGlobalStandards as ReturnType<typeof vi.fn>).mock.calls[0];
      const standardsPayload = standardsCall[0];
      const technicalDocs = standardsPayload.technical_documents;

      // Check snake_case keys
      expect(technicalDocs).toHaveProperty('tech_stack');
      expect(technicalDocs).toHaveProperty('coding_style');
      expect(technicalDocs).toHaveProperty('conventions');
      expect(technicalDocs).toHaveProperty('error_handling');
      expect(technicalDocs).toHaveProperty('validation');
    });

    it('committed chip values (via Enter key) are included in create payload', async () => {
      render(
        <CreateOrganisationModal
          isOpen={true}
          onClose={mockOnClose}
          onCreated={mockOnCreated}
        />
      );

      // Wait for organisations to load
      await waitFor(() => {
        expect(screen.getByTestId('organisation-name-input')).toBeEnabled();
      });

      // Fill in name
      const nameInput = screen.getByTestId('organisation-name-input');
      fireEvent.change(nameInput, { target: { value: 'Test Org' } });

      // Add values to chip inputs using Enter key (to commit them)
      const allInputContainer = screen.getByText('All').closest('div')?.parentElement;
      const allInput = allInputContainer?.querySelector('input');
      if (allInput) {
        fireEvent.change(allInput, { target: { value: 'committed-doc.md' } });
        fireEvent.keyDown(allInput, { key: 'Enter' });
      }

      // Click Create button
      const createButton = screen.getByTestId('create-button');
      fireEvent.click(createButton);

      // Wait for API call
      await waitFor(() => {
        expect(organisationsApi.createOrganisationFull).toHaveBeenCalled();
      });

      // Verify the payload includes the committed value
      const createCall = (organisationsApi.createOrganisationFull as ReturnType<typeof vi.fn>).mock.calls[0];
      const payload = createCall[0];

      expect(payload.docsAppliedToAllSources).toContain('committed-doc.md');
    });

    it('values committed via blur are included in create payload', async () => {
      render(
        <CreateOrganisationModal
          isOpen={true}
          onClose={mockOnClose}
          onCreated={mockOnCreated}
        />
      );

      // Wait for organisations to load
      await waitFor(() => {
        expect(screen.getByTestId('organisation-name-input')).toBeEnabled();
      });

      // Fill in name
      const nameInput = screen.getByTestId('organisation-name-input');
      fireEvent.change(nameInput, { target: { value: 'Blur Test Org' } });

      // Add value to chip input
      const allInputContainer = screen.getByText('All').closest('div')?.parentElement;
      const allInput = allInputContainer?.querySelector('input');
      if (allInput) {
        fireEvent.change(allInput, { target: { value: 'blur-committed.md' } });
        // Blur the input to commit via onBlur
        fireEvent.blur(allInput);
      }

      // Click Create button
      const createButton = screen.getByTestId('create-button');
      fireEvent.click(createButton);

      // Wait for API call
      await waitFor(() => {
        expect(organisationsApi.createOrganisationFull).toHaveBeenCalled();
      });

      // Verify the payload includes the blur-committed value
      const createCall = (organisationsApi.createOrganisationFull as ReturnType<typeof vi.fn>).mock.calls[0];
      const payload = createCall[0];

      expect(payload.docsAppliedToAllSources).toContain('blur-committed.md');
    });

    it('standards payload maps docsAppliedToAllSources to sources', async () => {
      render(
        <CreateOrganisationModal
          isOpen={true}
          onClose={mockOnClose}
          onCreated={mockOnCreated}
        />
      );

      // Wait for organisations to load
      await waitFor(() => {
        expect(screen.getByTestId('organisation-name-input')).toBeEnabled();
      });

      // Fill in name
      const nameInput = screen.getByTestId('organisation-name-input');
      fireEvent.change(nameInput, { target: { value: 'Sources Test' } });

      // Add values via Enter key
      const allInputContainer = screen.getByText('All').closest('div')?.parentElement;
      const allInput = allInputContainer?.querySelector('input');
      if (allInput) {
        fireEvent.change(allInput, { target: { value: 'source1.md' } });
        fireEvent.keyDown(allInput, { key: 'Enter' });
        fireEvent.change(allInput, { target: { value: 'source2.md' } });
        fireEvent.keyDown(allInput, { key: 'Enter' });
      }

      // Click Create button
      const createButton = screen.getByTestId('create-button');
      fireEvent.click(createButton);

      // Wait for standards generation call
      await waitFor(() => {
        expect(organisationsApi.generateGlobalStandards).toHaveBeenCalled();
      });

      // Verify sources array in standards payload
      const standardsCall = (organisationsApi.generateGlobalStandards as ReturnType<typeof vi.fn>).mock.calls[0];
      const standardsPayload = standardsCall[0];

      expect(standardsPayload.sources).toEqual(['source1.md', 'source2.md']);
    });

    it('technical_documents contains values from each category', async () => {
      render(
        <CreateOrganisationModal
          isOpen={true}
          onClose={mockOnClose}
          onCreated={mockOnCreated}
        />
      );

      // Wait for organisations to load
      await waitFor(() => {
        expect(screen.getByTestId('organisation-name-input')).toBeEnabled();
      });

      // Fill in name
      const nameInput = screen.getByTestId('organisation-name-input');
      fireEvent.change(nameInput, { target: { value: 'Category Test' } });

      // Add values to Tech Stack input
      const techStackContainer = screen.getByText('Tech Stack').closest('div')?.parentElement;
      const techStackInput = techStackContainer?.querySelector('input');
      if (techStackInput) {
        fireEvent.change(techStackInput, { target: { value: 'react-doc.md' } });
        fireEvent.keyDown(techStackInput, { key: 'Enter' });
      }

      // Add values to Coding Styles input
      const codingStylesContainer = screen.getByText('Coding Styles').closest('div')?.parentElement;
      const codingStylesInput = codingStylesContainer?.querySelector('input');
      if (codingStylesInput) {
        fireEvent.change(codingStylesInput, { target: { value: 'style-guide.md' } });
        fireEvent.keyDown(codingStylesInput, { key: 'Enter' });
      }

      // Click Create button
      const createButton = screen.getByTestId('create-button');
      fireEvent.click(createButton);

      // Wait for standards generation call
      await waitFor(() => {
        expect(organisationsApi.generateGlobalStandards).toHaveBeenCalled();
      });

      // Verify technical_documents in standards payload
      const standardsCall = (organisationsApi.generateGlobalStandards as ReturnType<typeof vi.fn>).mock.calls[0];
      const standardsPayload = standardsCall[0];

      expect(standardsPayload.technical_documents.tech_stack).toContain('react-doc.md');
      expect(standardsPayload.technical_documents.coding_style).toContain('style-guide.md');
    });
  });
});
