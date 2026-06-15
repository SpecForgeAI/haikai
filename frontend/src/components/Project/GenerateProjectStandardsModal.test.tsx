/**
 * Tests for GenerateProjectStandardsModal Component
 *
 * Spec 2026-01-31: Project-level Standards Generation
 * Task Group 3: GenerateProjectStandardsModal Component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GenerateProjectStandardsModal } from './GenerateProjectStandardsModal';
import type { ProjectDto } from '../../api/projectsApi';

// Mock the API functions
vi.mock('../../api/organisationsApi', async () => {
  const actual = await vi.importActual('../../api/organisationsApi');
  return {
    ...actual,
    getOrganisationById: vi.fn(),
  generateProjectStandards: vi.fn(),
  };
});

// Import mocked functions
import { getOrganisationById, generateProjectStandards } from '../../api/organisationsApi';

const mockActiveProject: ProjectDto = {
  id: 'project-123',
  name: 'Test Project',
  projectParentFolder: '/projects',
  projectHierarchy: null,
  organisationId: 'org-456',
  isActive: true,
  createdAt: '2026-01-31T00:00:00Z',
  updatedAt: '2026-01-31T00:00:00Z',
};

describe('GenerateProjectStandardsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getOrganisationById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'org-456',
      name: 'Test Organisation',
      description: null,
    });
    (generateProjectStandards as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('renders when isOpen is true', () => {
    const onClose = vi.fn();
    render(
      <GenerateProjectStandardsModal
        isOpen={true}
        onClose={onClose}
        activeProject={mockActiveProject}
      />
    );

    expect(screen.getByText('Generate Project Standards')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    const onClose = vi.fn();
    render(
      <GenerateProjectStandardsModal
        isOpen={false}
        onClose={onClose}
        activeProject={mockActiveProject}
      />
    );

    expect(screen.queryByText('Generate Project Standards')).not.toBeInTheDocument();
  });

  it('displays modal header "Generate Project Standards"', () => {
    const onClose = vi.fn();
    render(
      <GenerateProjectStandardsModal
        isOpen={true}
        onClose={onClose}
        activeProject={mockActiveProject}
      />
    );

    const header = screen.getByRole('heading', { name: 'Generate Project Standards' });
    expect(header).toBeInTheDocument();
  });

  it('displays body text with instructions', () => {
    const onClose = vi.fn();
    render(
      <GenerateProjectStandardsModal
        isOpen={true}
        onClose={onClose}
        activeProject={mockActiveProject}
      />
    );

    expect(
      screen.getByText(/Choose the input documents.*that will generate the project standards/i)
    ).toBeInTheDocument();
  });

  it('displays note about project standards overriding company standards', () => {
    const onClose = vi.fn();
    render(
      <GenerateProjectStandardsModal
        isOpen={true}
        onClose={onClose}
        activeProject={mockActiveProject}
      />
    );

    expect(
      screen.getByText(/project standards override your company standards/i)
    ).toBeInTheDocument();
  });

  it('disables Generate Standards button when sources is empty', () => {
    const onClose = vi.fn();
    render(
      <GenerateProjectStandardsModal
        isOpen={true}
        onClose={onClose}
        activeProject={mockActiveProject}
      />
    );

    const generateButton = screen.getByRole('button', { name: 'Generate Standards' });
    expect(generateButton).toBeDisabled();
  });

  it('enables Generate Standards button when sources are provided', async () => {
    const onClose = vi.fn();
    render(
      <GenerateProjectStandardsModal
        isOpen={true}
        onClose={onClose}
        activeProject={mockActiveProject}
      />
    );

    // Find the input and type a source
    const input = screen.getByPlaceholderText('Enter URLs or file paths...');
    fireEvent.change(input, { target: { value: 'http://example.com/docs' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      const generateButton = screen.getByRole('button', { name: 'Generate Standards' });
      expect(generateButton).not.toBeDisabled();
    });
  });

  it('shows "Generating..." and disables all inputs during loading state', async () => {
    // Make generateProjectStandards delay to observe loading state
    (generateProjectStandards as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    const onClose = vi.fn();
    render(
      <GenerateProjectStandardsModal
        isOpen={true}
        onClose={onClose}
        activeProject={mockActiveProject}
      />
    );

    // Add a source
    const input = screen.getByPlaceholderText('Enter URLs or file paths...');
    fireEvent.change(input, { target: { value: 'http://example.com/docs' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Click generate
    const generateButton = await screen.findByRole('button', { name: 'Generate Standards' });
    fireEvent.click(generateButton);

    // Check loading state
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generating...' })).toBeInTheDocument();
    });

    // Cancel button should be disabled
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    expect(cancelButton).toBeDisabled();
  });

  it('shows success toast and closes modal on successful submission', async () => {
    const onClose = vi.fn();
    render(
      <GenerateProjectStandardsModal
        isOpen={true}
        onClose={onClose}
        activeProject={mockActiveProject}
      />
    );

    // Add a source
    const input = screen.getByPlaceholderText('Enter URLs or file paths...');
    fireEvent.change(input, { target: { value: 'http://example.com/docs' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Click generate
    const generateButton = await screen.findByRole('button', { name: 'Generate Standards' });
    fireEvent.click(generateButton);

    // Wait for success
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    // Verify API was called with correct payload
    expect(generateProjectStandards).toHaveBeenCalledWith({
      company: 'Test Organisation',
      project: 'Test Project',
      sources: ['http://example.com/docs'],
    });
  });

  it('shows error toast but keeps modal open on failed submission', async () => {
    // Clear mocks and set up rejection
    vi.clearAllMocks();
    (getOrganisationById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'org-456',
      name: 'Test Organisation',
      description: null,
    });
    (generateProjectStandards as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Generation failed')
    );

    const onClose = vi.fn();
    render(
      <GenerateProjectStandardsModal
        isOpen={true}
        onClose={onClose}
        activeProject={mockActiveProject}
      />
    );

    // Add a source
    const input = screen.getByPlaceholderText('Enter URLs or file paths...');
    fireEvent.change(input, { target: { value: 'http://example.com/docs' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Wait for button to be enabled
    await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Generate Standards' });
      expect(button).not.toBeDisabled();
    });

    // Click generate
    const generateButton = screen.getByRole('button', { name: 'Generate Standards' });
    fireEvent.click(generateButton);

    // Wait for error toast to appear
    await waitFor(() => {
      expect(screen.getByText(/failed.*retry/i)).toBeInTheDocument();
    });

    // Modal should still be open (onClose should NOT be called)
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows error when organisation lookup fails', async () => {
    // Clear and set up mock specifically for this test
    vi.clearAllMocks();
    (getOrganisationById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (generateProjectStandards as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const onClose = vi.fn();

    render(
      <GenerateProjectStandardsModal
        isOpen={true}
        onClose={onClose}
        activeProject={mockActiveProject}
      />
    );

    // Add a source
    const input = screen.getByPlaceholderText('Enter URLs or file paths...');
    fireEvent.change(input, { target: { value: 'http://example.com/docs' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Wait for button to be enabled
    await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Generate Standards' });
      expect(button).not.toBeDisabled();
    });

    // Click generate
    const generateButton = screen.getByRole('button', { name: 'Generate Standards' });
    fireEvent.click(generateButton);

    // Wait for error message to appear in the modal
    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });

    // Check the error message content
    expect(screen.getByText(/Failed to resolve organisation/i)).toBeInTheDocument();

    // Modal should still be open (onClose should NOT be called)
    expect(onClose).not.toHaveBeenCalled();

    // generateProjectStandards should NOT have been called
    expect(generateProjectStandards).not.toHaveBeenCalled();
  });

  it('calls onClose when Cancel button is clicked', () => {
    const onClose = vi.fn();
    render(
      <GenerateProjectStandardsModal
        isOpen={true}
        onClose={onClose}
        activeProject={mockActiveProject}
      />
    );

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButton);

    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    render(
      <GenerateProjectStandardsModal
        isOpen={true}
        onClose={onClose}
        activeProject={mockActiveProject}
      />
    );

    const overlay = screen.getByTestId('modal-overlay');
    fireEvent.click(overlay);

    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(
      <GenerateProjectStandardsModal
        isOpen={true}
        onClose={onClose}
        activeProject={mockActiveProject}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });
});
