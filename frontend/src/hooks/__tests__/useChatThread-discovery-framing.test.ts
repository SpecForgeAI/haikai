/**
 * Tests for Phase 0 Completion and Handoff -- Frontend TASK_ARTIFACT_MAP Entry
 *
 * Spec 2026-04-04: Phase 0 Completion and Handoff
 * Task Group 5: Task Definition + Frontend TASK_ARTIFACT_MAP
 *
 * Test 1: TASK_ARTIFACT_MAP has correct entry for architect--discovery-framing
 */

import { describe, it, expect } from 'vitest';
import { TASK_ARTIFACT_MAP } from '../useChatThread';

describe('Phase 0 Completion -- Frontend TASK_ARTIFACT_MAP (Spec 2026-04-04, Task Group 5)', () => {
  // ========================================================================
  // Test 1: TASK_ARTIFACT_MAP has correct entry for architect--discovery-framing
  // ========================================================================
  it('TASK_ARTIFACT_MAP has correct entry for architect--discovery-framing', () => {
    const entry = TASK_ARTIFACT_MAP['architect--discovery-framing'];
    expect(entry).toBeDefined();
    expect(entry.artifactId).toBe('discovery-framing');
    expect(entry.artifactName).toBe('DISCOVERY_BRIEF');
    expect(entry.artifactKey).toBe('discoveryBrief');
    expect(entry.completionMessage).toBe('Discovery Framing complete.');
    expect(entry.warningText).toBe(
      'A Discovery Brief already exists. Completing this conversation will create a new revision.'
    );
    expect(entry.previewType).toBe('artifact-preview');
  });
});
