/**
 * Tests -- RightHandPanelShell content-wrapper overflow scoping.
 *
 * Spec 2026-06-27-target-conversation-right-panel-ux (Spec A, Task Group 3):
 * the shared shell's content wrapper used to be hard-coded `overflow: auto`,
 * which let the WHOLE conversation body scroll instead of just its transcript.
 * The wrapper overflow is now caller-controlled via `contentOverflow`:
 *   - default 'auto' keeps the long-standing behaviour Discovery relies on;
 *   - the Architect Conversation passes 'hidden' so its bounded inner height
 *     chain resolves and ONLY its transcript scrolls.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { RightHandPanelShell } from '../RightHandPanelShell';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderShell(overrides: Record<string, unknown> = {}) {
  render(
    <RightHandPanelShell
      storageKey="t1"
      personaId="architect"
      roomName="Target State v2"
      collapsedLabel="Architect"
      onClose={vi.fn()}
      {...overrides}
    >
      <div data-testid="shell-content">content</div>
    </RightHandPanelShell>,
  );
}

describe('RightHandPanelShell -- content-wrapper overflow scoping (Task Group 3)', () => {
  it('defaults the content wrapper to overflow: auto (Discovery behaviour)', () => {
    renderShell();
    const wrapper = screen.getByTestId('rhs-panel-content');
    expect(wrapper.style.overflow).toBe('auto');
  });

  it('renders the content wrapper with overflow: hidden when contentOverflow="hidden"', () => {
    renderShell({ contentOverflow: 'hidden' });
    const wrapper = screen.getByTestId('rhs-panel-content');
    expect(wrapper.style.overflow).toBe('hidden');
    // The hosted content is still mounted inside the bounded wrapper.
    expect(wrapper).toContainElement(screen.getByTestId('shell-content'));
  });
});
