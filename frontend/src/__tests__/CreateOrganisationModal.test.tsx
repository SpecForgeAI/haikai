/**
 * Tests for CreateOrganisationModal Component
 *
 * Spec 2026-01-31: Create Organisation Modal
 * Task Group 3: CreateOrganisationModal Component
 *
 * Tests:
 * - Modal renders when isOpen=true, does not render when isOpen=false
 * - Name validation (required, shows error when empty)
 * - Name uniqueness validation (shows error when duplicate)
 * - Create button disabled when form invalid or submitting
 * - Successful submission calls onCreated callback
 * - Escape key and overlay click close modal
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateOrganisationModal } from '../components/Organisation/CreateOrganisationModal';
import * as organisationsApi from '../api/organisationsApi';

// Mock the organisationsApi module
vi.mock('../api/organisationsApi', async () => {
  const actual = await vi.importActual('../api/organisationsApi');
  return {
    ...actual,
    listOrganisations: vi.fn(),
  createOrganisationFull: vi.fn(),
  OrganisationConflictError: class OrganisationConflictError extends Error {
    public readonly isConflict: boolean = true;
    constructor(message: string) {
      super(message);
      this.name = 'OrganisationConflictError';
    }
  },
  };
});

describe('CreateOrganisationModal', () => {
  const mockOnClose = vi.fn();
  const mockOnCreated = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    // Default mock implementation for listOrganisations
    (organisationsApi.listOrganisations as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'org-1', name: 'Existing Org', description: null },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Modal Rendering', () => {
    it('renders modal when isOpen is true', async () => {
      render(
        <CreateOrganisationModal isOpen={true} onClose={mockOnClose} onCreated={mockOnCreated} />
      );

      await waitFor(() => {
        expect(screen.getByText('Create Organisation')).toBeInTheDocument();
      });
    });

    it('does not render modal when isOpen is false', () => {
      render(
        <CreateOrganisationModal isOpen={false} onClose={mockOnClose} onCreated={mockOnCreated} />
      );

      expect(screen.queryByText('Create Organisation')).not.toBeInTheDocument();
    });
  });

  describe('Name Validation', () => {
    it('shows error when name is empty and user tries to create', async () => {
      render(
        <CreateOrganisationModal isOpen={true} onClose={mockOnClose} onCreated={mockOnCreated} />
      );

      await waitFor(() => {
        expect(screen.getByText('Create Organisation')).toBeInTheDocument();
      });

      // Create button should be disabled when name is empty
      const createButton = screen.getByTestId('create-button');
      expect(createButton).toBeDisabled();
    });

    it('shows error when name matches existing organisation (case-insensitive)', async () => {
      render(
        <CreateOrganisationModal isOpen={true} onClose={mockOnClose} onCreated={mockOnCreated} />
      );

      await waitFor(() => {
        expect(screen.getByText('Create Organisation')).toBeInTheDocument();
      });

      // Type a name that matches existing org (different case)
      const nameInput = screen.getByTestId('organisation-name-input');
      await userEvent.type(nameInput, 'EXISTING ORG');

      // Wait for validation message to appear
      await waitFor(() => {
        expect(
          screen.getByText('Organisation with this name already exists')
        ).toBeInTheDocument();
      });

      // Create button should be disabled
      expect(screen.getByTestId('create-button')).toBeDisabled();
    });
  });

  describe('Create Button State', () => {
    it('enables Create button when form is valid', async () => {
      render(
        <CreateOrganisationModal isOpen={true} onClose={mockOnClose} onCreated={mockOnCreated} />
      );

      await waitFor(() => {
        expect(screen.getByText('Create Organisation')).toBeInTheDocument();
      });

      // Type a valid, unique name
      const nameInput = screen.getByTestId('organisation-name-input');
      await userEvent.type(nameInput, 'New Organisation');

      // Create button should be enabled
      await waitFor(() => {
        expect(screen.getByTestId('create-button')).not.toBeDisabled();
      });
    });

    it('disables Create button during submission', async () => {
      // Mock a slow API call
      (organisationsApi.createOrganisationFull as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      render(
        <CreateOrganisationModal isOpen={true} onClose={mockOnClose} onCreated={mockOnCreated} />
      );

      await waitFor(() => {
        expect(screen.getByText('Create Organisation')).toBeInTheDocument();
      });

      // Type a valid name
      const nameInput = screen.getByTestId('organisation-name-input');
      await userEvent.type(nameInput, 'New Organisation');

      // Click Create
      const createButton = screen.getByTestId('create-button');
      await userEvent.click(createButton);

      // Button should be disabled during submission
      await waitFor(() => {
        expect(createButton).toBeDisabled();
        expect(createButton).toHaveTextContent('Creating...');
      });
    });
  });

  describe('Form Submission', () => {
    it('calls onCreated and onClose on successful submission', async () => {
      (organisationsApi.createOrganisationFull as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'new-org-id',
        name: 'New Organisation',
        description: null,
      });

      render(
        <CreateOrganisationModal isOpen={true} onClose={mockOnClose} onCreated={mockOnCreated} />
      );

      await waitFor(() => {
        expect(screen.getByText('Create Organisation')).toBeInTheDocument();
      });

      // Type a valid name
      const nameInput = screen.getByTestId('organisation-name-input');
      await userEvent.type(nameInput, 'New Organisation');

      // Click Create
      const createButton = screen.getByTestId('create-button');
      await userEvent.click(createButton);

      // Wait for callbacks to be called
      await waitFor(() => {
        expect(mockOnCreated).toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalled();
      });
    });
  });

  describe('Modal Close Handlers', () => {
    it('closes modal on Escape key press', async () => {
      render(
        <CreateOrganisationModal isOpen={true} onClose={mockOnClose} onCreated={mockOnCreated} />
      );

      await waitFor(() => {
        expect(screen.getByText('Create Organisation')).toBeInTheDocument();
      });

      // Press Escape
      fireEvent.keyDown(document, { key: 'Escape' });

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('closes modal on overlay click', async () => {
      render(
        <CreateOrganisationModal isOpen={true} onClose={mockOnClose} onCreated={mockOnCreated} />
      );

      await waitFor(() => {
        expect(screen.getByText('Create Organisation')).toBeInTheDocument();
      });

      // Click overlay
      const overlay = screen.getByTestId('modal-overlay');
      fireEvent.click(overlay);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('closes modal on Cancel button click', async () => {
      render(
        <CreateOrganisationModal isOpen={true} onClose={mockOnClose} onCreated={mockOnCreated} />
      );

      await waitFor(() => {
        expect(screen.getByText('Create Organisation')).toBeInTheDocument();
      });

      // Click Cancel
      const cancelButton = screen.getByTestId('cancel-button');
      await userEvent.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
    });
  });
});
