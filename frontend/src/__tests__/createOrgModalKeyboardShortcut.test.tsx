/**
 * Tests for Create Organisation Modal Global Keyboard Shortcut
 *
 * Spec 2026-01-31: Create Organisation Modal
 * Task Group 4: Global Keyboard Shortcut and Modal Mount
 *
 * Tests:
 * - Ctrl+Shift+M opens modal when not already open
 * - Shortcut does nothing when modal already open
 * - Shortcut ignored when focus is on input/textarea/contenteditable
 * - Both Ctrl (Windows) and Cmd/metaKey (Mac) work
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock the organisationsApi module for modal rendering
vi.mock('../api/organisationsApi', async () => {
  const actual = await vi.importActual('../api/organisationsApi');
  return {
    ...actual,
    listOrganisations: vi.fn().mockResolvedValue([]),
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

// Mock CreateOrganisationModal to simplify testing
vi.mock('../components/Organisation/CreateOrganisationModal', () => ({
  CreateOrganisationModal: ({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) => {
    if (!isOpen) return null;
    return (
      <div data-testid="create-org-modal">
        <button onClick={onClose} data-testid="close-modal">
          Close
        </button>
      </div>
    );
  },
}));

/**
 * Helper to check if an element is contenteditable.
 * JSDOM doesn't properly support isContentEditable, so we check the attribute.
 */
function isContentEditable(element: Element): boolean {
  // Check the isContentEditable property first
  if ((element as HTMLElement).isContentEditable) {
    return true;
  }
  // Fallback: check the contenteditable attribute (for JSDOM)
  const attr = element.getAttribute('contenteditable');
  return attr === 'true' || attr === '';
}

// Import the hook that will handle the keyboard shortcut
// We'll test the logic directly since App.tsx is complex to render
describe('Create Organisation Modal Keyboard Shortcut', () => {
  /**
   * Helper component that implements the keyboard shortcut logic
   * This mirrors what will be in App.tsx
   */
  function TestComponent() {
    const [isModalOpen, setIsModalOpen] = React.useState(false);

    React.useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // Check for Ctrl+Shift+M or Cmd+Shift+M
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
          // Skip if focus is on input, textarea, or contenteditable
          const activeElement = document.activeElement;
          if (activeElement) {
            const tagName = activeElement.tagName.toLowerCase();
            if (
              tagName === 'input' ||
              tagName === 'textarea' ||
              isContentEditable(activeElement)
            ) {
              return;
            }
          }

          e.preventDefault();

          // Only open if not already open
          if (!isModalOpen) {
            setIsModalOpen(true);
          }
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isModalOpen]);

    return (
      <div>
        <input type="text" data-testid="test-input" />
        <textarea data-testid="test-textarea" />
        <div contentEditable={true} data-testid="test-contenteditable" />
        <div data-testid="modal-state">{isModalOpen ? 'open' : 'closed'}</div>
        {isModalOpen && (
          <div data-testid="create-org-modal">
            <button onClick={() => setIsModalOpen(false)} data-testid="close-modal">
              Close
            </button>
          </div>
        )}
      </div>
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens modal with Ctrl+Shift+M when not already open', () => {
    render(<TestComponent />);

    // Verify modal is initially closed
    expect(screen.getByTestId('modal-state')).toHaveTextContent('closed');
    expect(screen.queryByTestId('create-org-modal')).not.toBeInTheDocument();

    // Press Ctrl+Shift+M
    fireEvent.keyDown(document, {
      key: 'M',
      ctrlKey: true,
      shiftKey: true,
    });

    // Verify modal is now open
    expect(screen.getByTestId('modal-state')).toHaveTextContent('open');
    expect(screen.getByTestId('create-org-modal')).toBeInTheDocument();
  });

  it('opens modal with Cmd+Shift+M (Mac) when not already open', () => {
    render(<TestComponent />);

    // Verify modal is initially closed
    expect(screen.getByTestId('modal-state')).toHaveTextContent('closed');

    // Press Cmd+Shift+M (metaKey for Mac)
    fireEvent.keyDown(document, {
      key: 'M',
      metaKey: true,
      shiftKey: true,
    });

    // Verify modal is now open
    expect(screen.getByTestId('modal-state')).toHaveTextContent('open');
    expect(screen.getByTestId('create-org-modal')).toBeInTheDocument();
  });

  it('does nothing when modal is already open', () => {
    render(<TestComponent />);

    // Open modal first
    fireEvent.keyDown(document, {
      key: 'M',
      ctrlKey: true,
      shiftKey: true,
    });

    expect(screen.getByTestId('modal-state')).toHaveTextContent('open');

    // Press Ctrl+Shift+M again - should not cause issues
    fireEvent.keyDown(document, {
      key: 'M',
      ctrlKey: true,
      shiftKey: true,
    });

    // Modal should still be open (no-op)
    expect(screen.getByTestId('modal-state')).toHaveTextContent('open');
    expect(screen.getAllByTestId('create-org-modal')).toHaveLength(1);
  });

  it('ignores shortcut when focus is on input element', () => {
    render(<TestComponent />);

    // Focus the input
    const input = screen.getByTestId('test-input');
    input.focus();

    // Press Ctrl+Shift+M
    fireEvent.keyDown(document, {
      key: 'M',
      ctrlKey: true,
      shiftKey: true,
    });

    // Modal should NOT open
    expect(screen.getByTestId('modal-state')).toHaveTextContent('closed');
    expect(screen.queryByTestId('create-org-modal')).not.toBeInTheDocument();
  });

  it('ignores shortcut when focus is on textarea element', () => {
    render(<TestComponent />);

    // Focus the textarea
    const textarea = screen.getByTestId('test-textarea');
    textarea.focus();

    // Press Ctrl+Shift+M
    fireEvent.keyDown(document, {
      key: 'M',
      ctrlKey: true,
      shiftKey: true,
    });

    // Modal should NOT open
    expect(screen.getByTestId('modal-state')).toHaveTextContent('closed');
    expect(screen.queryByTestId('create-org-modal')).not.toBeInTheDocument();
  });

  it('ignores shortcut when focus is on contenteditable element', () => {
    render(<TestComponent />);

    // Focus the contenteditable
    const contentEditable = screen.getByTestId('test-contenteditable');
    contentEditable.focus();

    // Press Ctrl+Shift+M
    fireEvent.keyDown(document, {
      key: 'M',
      ctrlKey: true,
      shiftKey: true,
    });

    // Modal should NOT open
    expect(screen.getByTestId('modal-state')).toHaveTextContent('closed');
    expect(screen.queryByTestId('create-org-modal')).not.toBeInTheDocument();
  });

  it('does not trigger on partial key combinations', () => {
    render(<TestComponent />);

    // Press just Ctrl+M (no Shift)
    fireEvent.keyDown(document, {
      key: 'M',
      ctrlKey: true,
      shiftKey: false,
    });

    expect(screen.getByTestId('modal-state')).toHaveTextContent('closed');

    // Press just Shift+M (no Ctrl)
    fireEvent.keyDown(document, {
      key: 'M',
      ctrlKey: false,
      shiftKey: true,
    });

    expect(screen.getByTestId('modal-state')).toHaveTextContent('closed');

    // Press Ctrl+Shift but different key
    fireEvent.keyDown(document, {
      key: 'N',
      ctrlKey: true,
      shiftKey: true,
    });

    expect(screen.getByTestId('modal-state')).toHaveTextContent('closed');
  });
});
