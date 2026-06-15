/**
 * Tests for CreateOrganisationModal Standards Generation Integration
 *
 * Spec 2026-01-31: Trigger Global Standards Generation
 * Task Group 6: CreateOrganisationModal Integration
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CreateOrganisationModal } from './CreateOrganisationModal';
import * as organisationsApi from '../../api/organisationsApi';

// Mock the API module
vi.mock('../../api/organisationsApi', async () => {
  const actual = await vi.importActual('../../api/organisationsApi');
  return {
    ...actual,
    listOrganisations: vi.fn(),
  createOrganisationFull: vi.fn(),
  generateGlobalStandards: vi.fn(),
  OrganisationConflictError: class OrganisationConflictError extends Error {
    isConflict = true;
    constructor(message: string) {
      super(message);
      this.name = 'OrganisationConflictError';
    }
  },
  };
});

describe('CreateOrganisationModal Standards Integration', () => {
  const mockOnClose = vi.fn();
  const mockOnCreated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: list returns empty array immediately
    vi.mocked(organisationsApi.listOrganisations).mockResolvedValue([]);
  });

  const renderModal = () => {
    return render(
      <CreateOrganisationModal
        isOpen={true}
        onClose={mockOnClose}
        onCreated={mockOnCreated}
      />
    );
  };

  describe('success flow', () => {
    it('creates organisation, generates standards, and closes modal', async () => {
      const createdOrg = { id: 'org-123', name: 'Test Org', description: null };
      vi.mocked(organisationsApi.createOrganisationFull).mockResolvedValue(createdOrg);
      vi.mocked(organisationsApi.generateGlobalStandards).mockResolvedValue(undefined);

      renderModal();

      // Wait for the modal to load
      await waitFor(() => {
        expect(screen.getByTestId('organisation-name-input')).toBeEnabled();
      });

      // Type in a name
      const nameInput = screen.getByTestId('organisation-name-input');
      fireEvent.change(nameInput, { target: { value: 'Test Org' } });

      // Click Create
      const createButton = screen.getByTestId('create-button');
      fireEvent.click(createButton);

      // Wait for all API calls to complete
      await waitFor(() => {
        expect(organisationsApi.createOrganisationFull).toHaveBeenCalled();
        expect(organisationsApi.generateGlobalStandards).toHaveBeenCalled();
      });

      // Verify generateGlobalStandards was called with the external-compatible
      // payload schema (Spec 2026-01-31 Task Group 2: no organisationId -- the
      // gateway resolves by company name; snake_case technical_documents).
      expect(organisationsApi.generateGlobalStandards).toHaveBeenCalledWith({
        company: 'Test Org',
        sources: [],
        technical_documents: {
          tech_stack: [],
          coding_style: [],
          conventions: [],
          error_handling: [],
          validation: [],
        },
      });

      // Verify callbacks were called
      await waitFor(() => {
        expect(mockOnCreated).toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalled();
      });
    });
  });

  describe('failure flow', () => {
    it('still calls onCreated when standards generation fails but org is created', async () => {
      const createdOrg = { id: 'org-456', name: 'New Org', description: null };
      vi.mocked(organisationsApi.createOrganisationFull).mockResolvedValue(createdOrg);
      vi.mocked(organisationsApi.generateGlobalStandards).mockRejectedValue(
        new Error('Standards service unavailable')
      );

      renderModal();

      // Wait for the modal to load
      await waitFor(() => {
        expect(screen.getByTestId('organisation-name-input')).toBeEnabled();
      });

      // Type in a name
      const nameInput = screen.getByTestId('organisation-name-input');
      fireEvent.change(nameInput, { target: { value: 'New Org' } });

      // Click Create
      const createButton = screen.getByTestId('create-button');
      fireEvent.click(createButton);

      // Wait for API calls
      await waitFor(() => {
        expect(organisationsApi.createOrganisationFull).toHaveBeenCalled();
        expect(organisationsApi.generateGlobalStandards).toHaveBeenCalled();
      });

      // Organisation is still created - onCreated should be called
      await waitFor(() => {
        expect(mockOnCreated).toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalled();
      });
    });
  });

  describe('organisation creation failure', () => {
    it('does not call generateGlobalStandards when createOrganisationFull fails', async () => {
      vi.mocked(organisationsApi.createOrganisationFull).mockRejectedValue(
        new Error('Database error')
      );

      renderModal();

      // Wait for the modal to load
      await waitFor(() => {
        expect(screen.getByTestId('organisation-name-input')).toBeEnabled();
      });

      // Type in a name
      const nameInput = screen.getByTestId('organisation-name-input');
      fireEvent.change(nameInput, { target: { value: 'Failed Org' } });

      // Click Create
      const createButton = screen.getByTestId('create-button');
      fireEvent.click(createButton);

      // Wait for API call to fail
      await waitFor(() => {
        expect(organisationsApi.createOrganisationFull).toHaveBeenCalled();
      });

      // Wait a bit for any async updates
      await waitFor(() => {
        // generateGlobalStandards should NOT be called
        expect(organisationsApi.generateGlobalStandards).not.toHaveBeenCalled();
      });

      // Modal should NOT be closed
      expect(mockOnClose).not.toHaveBeenCalled();
      expect(mockOnCreated).not.toHaveBeenCalled();

      // Error message should be shown
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Database error');
      });
    });
  });

  describe('button state during submission', () => {
    it('disables Create button after click and before completion', async () => {
      const createdOrg = { id: 'org-123', name: 'Test Org', description: null };

      // Create a promise that we can control
      let resolveCreate: (value: typeof createdOrg) => void;
      vi.mocked(organisationsApi.createOrganisationFull).mockImplementation(
        () => new Promise((resolve) => { resolveCreate = resolve; })
      );
      vi.mocked(organisationsApi.generateGlobalStandards).mockResolvedValue(undefined);

      renderModal();

      // Wait for the modal to load
      await waitFor(() => {
        expect(screen.getByTestId('organisation-name-input')).toBeEnabled();
      });

      // Type in a name
      const nameInput = screen.getByTestId('organisation-name-input');
      fireEvent.change(nameInput, { target: { value: 'Test Org' } });

      // Click Create
      const createButton = screen.getByTestId('create-button');
      fireEvent.click(createButton);

      // Button should be disabled while creating
      await waitFor(() => {
        expect(screen.getByTestId('create-button')).toBeDisabled();
      });

      // Resolve the creation
      await act(async () => {
        resolveCreate!(createdOrg);
      });

      // Wait for completion
      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });
  });

  describe('handleCreate calls generateGlobalStandards with the company name', () => {
    // Spec 2026-01-31 Task Group 2: organisationId was removed from the
    // payload -- the gateway resolves the organisation by `company` name.
    it('passes the organisation name as company to generateGlobalStandards', async () => {
      const createdOrg = { id: 'org-xyz-789', name: 'My Org', description: 'Test' };
      vi.mocked(organisationsApi.createOrganisationFull).mockResolvedValue(createdOrg);
      vi.mocked(organisationsApi.generateGlobalStandards).mockResolvedValue(undefined);

      renderModal();

      // Wait for the modal to load
      await waitFor(() => {
        expect(screen.getByTestId('organisation-name-input')).toBeEnabled();
      });

      // Type in a name
      const nameInput = screen.getByTestId('organisation-name-input');
      fireEvent.change(nameInput, { target: { value: 'My Org' } });

      // Click Create
      const createButton = screen.getByTestId('create-button');
      fireEvent.click(createButton);

      // Wait for generateGlobalStandards to be called
      await waitFor(() => {
        expect(organisationsApi.generateGlobalStandards).toHaveBeenCalled();
      });

      // Verify the company name is passed correctly (no organisationId in
      // the external-compatible schema)
      const callArgs = vi.mocked(organisationsApi.generateGlobalStandards).mock.calls[0][0];
      expect(callArgs.company).toBe('My Org');
      expect((callArgs as Record<string, unknown>).organisationId).toBeUndefined();
    });
  });
});
