/**
 * WorkItemEditModal Component Tests
 *
 * Spec 2026-01-17: Fix Feature Edit 400 Error
 * Task Group 3: Tests for type field handling in WorkItemEditModal
 *
 * Updated: handleSubmit now also includes parentId in the update payload
 * (Spec 2026-01-18: Include parentId field to preserve parent relationship).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkItemEditModal } from '../components/ProductView/WorkItemEditModal';
import type { WorkItem } from '../types/workItems';

// Mock the workItemsApi module
vi.mock('../api/workItemsApi', () => ({
  updateWorkItem: vi.fn(),
}));

// Import after mock
import { updateWorkItem } from '../api/workItemsApi';

describe('WorkItemEditModal (Spec 2026-01-17)', () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  const mockFeatureItem: WorkItem = {
    id: 'feature-123',
    projectId: 'test-project',
    type: 'FEATURE',
    parentId: 'epic-001',
    title: 'Test Feature',
    description: 'Test description',
    status: 'PLANNED',
    sortOrder: 1,
    priority: 1,
    targetWindow: '2026-Q2',
    tags: null,
    externalSystem: null,
    externalKey: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const mockStoryItem: WorkItem = {
    id: 'story-456',
    projectId: 'test-project',
    type: 'STORY',
    parentId: 'feature-123',
    title: 'Test Story',
    description: null,
    status: 'READY',
    sortOrder: 1,
    priority: null,
    targetWindow: null,
    tags: null,
    externalSystem: null,
    externalKey: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================
  // Task Group 3.1: Tests for type field handling
  // ============================================

  describe('handleSubmit includes type: item.type in update payload', () => {
    it('should include type: FEATURE in update payload for Feature edits', async () => {
      // Given
      const updatedItem: WorkItem = {
        ...mockFeatureItem,
        title: 'Updated Feature Title',
      };

      (updateWorkItem as ReturnType<typeof vi.fn>).mockResolvedValue(updatedItem);

      render(
        <WorkItemEditModal
          isOpen={true}
          onClose={mockOnClose}
          item={mockFeatureItem}
          onSuccess={mockOnSuccess}
          projectId="test-project"
        />
      );

      // When - Update the title and submit
      const titleInput = screen.getByTestId('field-title');
      fireEvent.change(titleInput, { target: { value: 'Updated Feature Title' } });

      const submitButton = screen.getByTestId('modal-submit-button');
      fireEvent.click(submitButton);

      // Then - Verify updateWorkItem was called with type and parentId fields
      await waitFor(() => {
        expect(updateWorkItem).toHaveBeenCalledTimes(1);
        expect(updateWorkItem).toHaveBeenCalledWith(
          'test-project',
          'feature-123',
          expect.objectContaining({
            type: 'FEATURE',
            parentId: 'epic-001',
            title: 'Updated Feature Title',
          })
        );
      });
    });

    it('should include type: STORY in update payload for Story edits', async () => {
      // Given
      const updatedItem: WorkItem = {
        ...mockStoryItem,
        title: 'Updated Story Title',
      };

      (updateWorkItem as ReturnType<typeof vi.fn>).mockResolvedValue(updatedItem);

      render(
        <WorkItemEditModal
          isOpen={true}
          onClose={mockOnClose}
          item={mockStoryItem}
          onSuccess={mockOnSuccess}
          projectId="test-project"
        />
      );

      // When - Update the title and submit
      const titleInput = screen.getByTestId('field-title');
      fireEvent.change(titleInput, { target: { value: 'Updated Story Title' } });

      const submitButton = screen.getByTestId('modal-submit-button');
      fireEvent.click(submitButton);

      // Then - Verify updateWorkItem was called with type and parentId fields
      await waitFor(() => {
        expect(updateWorkItem).toHaveBeenCalledTimes(1);
        expect(updateWorkItem).toHaveBeenCalledWith(
          'test-project',
          'story-456',
          expect.objectContaining({
            type: 'STORY',
            parentId: 'feature-123',
            title: 'Updated Story Title',
          })
        );
      });
    });
  });

  describe('modal rendering guards', () => {
    it('should not render modal when item.type is empty string', () => {
      // Given - Item with empty type (edge case)
      // Note: The modal has a guard that prevents rendering for non-FEATURE/STORY types
      const malformedItem: WorkItem = {
        ...mockFeatureItem,
        type: '' as WorkItem['type'], // Empty string
      };

      render(
        <WorkItemEditModal
          isOpen={true}
          onClose={mockOnClose}
          item={malformedItem}
          onSuccess={mockOnSuccess}
          projectId="test-project"
        />
      );

      // Then - Modal should not render (guard against invalid types)
      expect(screen.queryByTestId('work-item-edit-modal')).not.toBeInTheDocument();
    });

    it('should not render modal for INITIATIVE type', () => {
      // Given - INITIATIVE type item
      const initiativeItem: WorkItem = {
        ...mockFeatureItem,
        type: 'INITIATIVE',
      };

      render(
        <WorkItemEditModal
          isOpen={true}
          onClose={mockOnClose}
          item={initiativeItem}
          onSuccess={mockOnSuccess}
          projectId="test-project"
        />
      );

      // Then - Modal should not render
      expect(screen.queryByTestId('work-item-edit-modal')).not.toBeInTheDocument();
    });

    it('should not render modal for EPIC type', () => {
      // Given - EPIC type item
      const epicItem: WorkItem = {
        ...mockFeatureItem,
        type: 'EPIC',
      };

      render(
        <WorkItemEditModal
          isOpen={true}
          onClose={mockOnClose}
          item={epicItem}
          onSuccess={mockOnSuccess}
          projectId="test-project"
        />
      );

      // Then - Modal should not render
      expect(screen.queryByTestId('work-item-edit-modal')).not.toBeInTheDocument();
    });
  });

  describe('type validation ensures type is always sent', () => {
    it('should always include type in update payload for FEATURE items', async () => {
      // Given
      const updatedItem: WorkItem = {
        ...mockFeatureItem,
        title: 'Updated Title',
        status: 'IN_PROGRESS',
      };

      (updateWorkItem as ReturnType<typeof vi.fn>).mockResolvedValue(updatedItem);

      render(
        <WorkItemEditModal
          isOpen={true}
          onClose={mockOnClose}
          item={mockFeatureItem}
          onSuccess={mockOnSuccess}
          projectId="test-project"
        />
      );

      // When - Change status and submit
      const statusSelect = screen.getByTestId('field-status');
      fireEvent.change(statusSelect, { target: { value: 'IN_PROGRESS' } });

      const submitButton = screen.getByTestId('modal-submit-button');
      fireEvent.click(submitButton);

      // Then - Verify type is always included in the payload
      await waitFor(() => {
        expect(updateWorkItem).toHaveBeenCalledWith(
          'test-project',
          'feature-123',
          expect.objectContaining({
            type: 'FEATURE', // This is the key fix - type must always be present
          })
        );
      });

      // Verify the payload structure
      const callArgs = (updateWorkItem as ReturnType<typeof vi.fn>).mock.calls[0];
      const payload = callArgs[2];
      expect(payload.type).toBe('FEATURE');
    });
  });

  // ============================================
  // Additional tests for complete coverage
  // ============================================

  describe('successful update flow', () => {
    it('should call onSuccess and onClose after successful update', async () => {
      // Given
      const updatedItem: WorkItem = {
        ...mockFeatureItem,
        title: 'Successfully Updated',
      };

      (updateWorkItem as ReturnType<typeof vi.fn>).mockResolvedValue(updatedItem);

      render(
        <WorkItemEditModal
          isOpen={true}
          onClose={mockOnClose}
          item={mockFeatureItem}
          onSuccess={mockOnSuccess}
          projectId="test-project"
        />
      );

      // When
      const titleInput = screen.getByTestId('field-title');
      fireEvent.change(titleInput, { target: { value: 'Successfully Updated' } });

      const submitButton = screen.getByTestId('modal-submit-button');
      fireEvent.click(submitButton);

      // Then
      await waitFor(() => {
        expect(mockOnSuccess).toHaveBeenCalledWith(updatedItem);
        expect(mockOnClose).toHaveBeenCalled();
      });
    });
  });

  describe('API error handling', () => {
    it('should display API error in formError div', async () => {
      // Given
      (updateWorkItem as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('400 Bad Request - Work item type is required')
      );

      render(
        <WorkItemEditModal
          isOpen={true}
          onClose={mockOnClose}
          item={mockFeatureItem}
          onSuccess={mockOnSuccess}
          projectId="test-project"
        />
      );

      // When
      const submitButton = screen.getByTestId('modal-submit-button');
      fireEvent.click(submitButton);

      // Then
      await waitFor(() => {
        const errorDiv = screen.getByTestId('form-error');
        expect(errorDiv).toBeInTheDocument();
        expect(errorDiv.textContent).toContain('400 Bad Request');
      });
    });
  });

  describe('payload includes all editable fields', () => {
    it('should include all fields in update payload when modified', async () => {
      // Given
      const updatedItem: WorkItem = {
        ...mockFeatureItem,
        title: 'New Title',
        description: 'New Description',
        status: 'IN_PROGRESS',
        priority: 5,
        targetWindow: '2026-Q3',
      };

      (updateWorkItem as ReturnType<typeof vi.fn>).mockResolvedValue(updatedItem);

      render(
        <WorkItemEditModal
          isOpen={true}
          onClose={mockOnClose}
          item={mockFeatureItem}
          onSuccess={mockOnSuccess}
          projectId="test-project"
        />
      );

      // When - Modify all fields
      fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'New Title' } });
      fireEvent.change(screen.getByTestId('field-description'), { target: { value: 'New Description' } });
      fireEvent.change(screen.getByTestId('field-status'), { target: { value: 'IN_PROGRESS' } });
      fireEvent.change(screen.getByTestId('field-priority'), { target: { value: '5' } });
      fireEvent.change(screen.getByTestId('field-targetWindow'), { target: { value: '2026-Q3' } });

      const submitButton = screen.getByTestId('modal-submit-button');
      fireEvent.click(submitButton);

      // Then - Verify all fields are in the payload including type and parentId
      await waitFor(() => {
        expect(updateWorkItem).toHaveBeenCalledWith(
          'test-project',
          'feature-123',
          {
            type: 'FEATURE',
            parentId: 'epic-001',
            title: 'New Title',
            description: 'New Description',
            status: 'IN_PROGRESS',
            priority: 5,
            targetWindow: '2026-Q3',
          }
        );
      });
    });
  });
});
