/**
 * View Temporary Diagram Link Tests
 *
 * Spec 2026-03-26: Render Temporary Architecture Diagrams in Frontend (Increment 4)
 * Task Group 5, Task 5.1: Write 4 focused tests for the chat panel "View Diagram" link
 *
 * Tests verify:
 * - Test 1: Assistant message with json:temporaryArchitectureDiagram code block renders "View Diagram" link
 * - Test 2: Assistant message without the code block renders no "View Diagram" link
 * - Test 3: Clicking "View Diagram" extracts diagram.id from the parsed JSON payload
 * - Test 4: Clicking "View Diagram" calls onViewTemporaryDiagram with the correct temporaryDiagramId
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageBubble } from '../MessageBubble';
import type { ThreadMessage } from '../../../api/chatV2Api';

// ============================================================================
// Test Data
// ============================================================================

/**
 * A valid TemporaryArchitectureDiagram JSON payload embedded in a code block.
 */
const validDiagramPayload = JSON.stringify({
  id: 'temp-diagram-abc-123',
  name: 'Order Management ER Diagram',
  diagram_kind: 'ER',
  version: '1.0',
  nodes: [
    {
      id: 'node-1',
      ref_name: 'Order',
      display_name: 'Order',
      semantic_type: 'LOGICAL_DATA_ENTITY',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 120,
    },
  ],
  edges: [],
}, null, 2);

/**
 * An assistant message containing a json:temporaryArchitectureDiagram code block.
 */
const messageWithDiagramBlock: ThreadMessage = {
  id: 'msg-diagram-1',
  role: 'assistant',
  personaId: 'architect',
  taskId: 'architect--generate-architecture-diagram',
  content: `I have generated the ER diagram for your order management system.\n\n\`\`\`json:temporaryArchitectureDiagram\n${validDiagramPayload}\n\`\`\`\n\nYou can view the diagram above.`,
  structuredResponse: null,
  timestamp: '2026-03-26T10:00:00.000Z',
};

/**
 * A regular assistant message without a diagram code block.
 */
const messageWithoutDiagramBlock: ThreadMessage = {
  id: 'msg-regular-1',
  role: 'assistant',
  personaId: 'architect',
  taskId: 'architect--define-architecture',
  content: 'Here is the architecture baseline for your system.',
  structuredResponse: null,
  timestamp: '2026-03-26T10:01:00.000Z',
};

/**
 * An assistant message with a malformed JSON in the code block.
 */
const messageWithMalformedJson: ThreadMessage = {
  id: 'msg-malformed-1',
  role: 'assistant',
  personaId: 'architect',
  taskId: 'architect--generate-architecture-diagram',
  content: 'I generated a diagram.\n\n```json:temporaryArchitectureDiagram\n{ invalid json !!! }\n```\n\nDone.',
  structuredResponse: null,
  timestamp: '2026-03-26T10:02:00.000Z',
};

// ============================================================================
// Tests
// ============================================================================

describe('View Temporary Diagram Link', () => {
  it('renders a "View Diagram" link when assistant message contains a json:temporaryArchitectureDiagram code block', () => {
    render(
      <MessageBubble
        message={messageWithDiagramBlock}
        onViewTemporaryDiagram={vi.fn()}
      />
    );

    const viewDiagramLink = screen.getByTestId('view-temporary-diagram-link');
    expect(viewDiagramLink).toBeInTheDocument();
    expect(viewDiagramLink).toHaveTextContent('View Diagram');
  });

  it('does NOT render a "View Diagram" link when assistant message does not contain the code block', () => {
    render(
      <MessageBubble
        message={messageWithoutDiagramBlock}
        onViewTemporaryDiagram={vi.fn()}
      />
    );

    expect(screen.queryByTestId('view-temporary-diagram-link')).not.toBeInTheDocument();
  });

  it('extracts diagram.id from the parsed JSON payload when clicking "View Diagram"', () => {
    const onViewTemporaryDiagram = vi.fn();

    render(
      <MessageBubble
        message={messageWithDiagramBlock}
        onViewTemporaryDiagram={onViewTemporaryDiagram}
      />
    );

    const viewDiagramLink = screen.getByTestId('view-temporary-diagram-link');
    fireEvent.click(viewDiagramLink);

    // Should be called with the diagram id extracted from the JSON payload
    expect(onViewTemporaryDiagram).toHaveBeenCalledTimes(1);
    expect(onViewTemporaryDiagram).toHaveBeenCalledWith('temp-diagram-abc-123');
  });

  it('does not render "View Diagram" link when code block contains malformed JSON', () => {
    render(
      <MessageBubble
        message={messageWithMalformedJson}
        onViewTemporaryDiagram={vi.fn()}
      />
    );

    // Malformed JSON should be handled gracefully -- no link rendered
    expect(screen.queryByTestId('view-temporary-diagram-link')).not.toBeInTheDocument();
  });
});
