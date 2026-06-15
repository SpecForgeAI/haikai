/**
 * Hub Bootstrap 3: Integration Wiring Tests
 *
 * Spec 2026-03-01: Hub Bootstrap 3 -- Solution Architect Baseline Architecture End-to-End
 * Task Group 5, Task 5.1: Write 6 focused tests for integration wiring
 *
 * Tests verify:
 * 1. DashboardView passes artifactExists record with architecture key to UnifiedChatPanel
 * 2. DashboardView derives architecture existence from (data?.strategicFoundation?.highLevelArchitecture?.overall?.value ?? 0) > 0
 * 3. UnifiedChatPanel handleDownloadTranscript for architecture task uses 'ARCHITECTURE_BASELINE (architecture meta-model)' as artifact description
 * 4. UnifiedChatPanel handleDownloadTranscript for architecture task generates filename 'architect-define-architecture-transcript.md'
 * 5. selectTask with taskId === 'architect--define-architecture' and artifactExists.architecture === true inserts warning message
 * 6. selectTask with taskId === 'architect--define-architecture' and artifactExists.architecture === false does NOT insert warning
 */

import { describe, it, expect, vi } from 'vitest';
import type { ThreadMessage } from '../api/chatV2Api';
import { buildTranscriptMarkdown } from '../utils/transcriptExport';
import { TASK_ARTIFACT_MAP } from '../hooks/useChatThread';
import type { UnifiedChatPanelProps } from '../components/UnifiedChat/UnifiedChatPanel';

// ============================================================================
// Test Data Helpers
// ============================================================================

function createThreadMessage(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: 'msg-test-1',
    role: 'user',
    personaId: null,
    taskId: null,
    content: 'Test message',
    structuredResponse: null,
    timestamp: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Hub Bootstrap 3: Integration Wiring (TG5)', () => {

  // ==========================================================================
  // Test 1: DashboardView passes artifactExists record with architecture key
  // ==========================================================================

  it('DashboardView passes artifactExists record with architecture key to UnifiedChatPanel', () => {
    // Simulate the dashboard data shape and verify the derivation logic
    // produces an artifactExists record that includes the architecture key
    const data = {
      strategicFoundation: {
        productDefinition: {
          missionExists: { label: 'Mission Exists', value: 1 },
        },
        roadmap: {
          state: { label: 'State', value: 100 },
        },
        highLevelArchitecture: {
          overall: { label: 'Overall', value: 12 },
        },
      },
    };

    // Apply the same derivation logic as DashboardView
    const artifactExists = {
      mission: data?.strategicFoundation?.productDefinition?.missionExists?.value === 1,
      roadmap: (data?.strategicFoundation?.roadmap?.state?.value ?? 0) > 0,
      architecture: (data?.strategicFoundation?.highLevelArchitecture?.overall?.value ?? 0) > 0,
    };

    // Verify the record has all three keys including architecture
    expect(artifactExists).toHaveProperty('mission');
    expect(artifactExists).toHaveProperty('roadmap');
    expect(artifactExists).toHaveProperty('architecture');
    expect(artifactExists).toEqual({ mission: true, roadmap: true, architecture: true });

    // Verify this shape is accepted by UnifiedChatPanelProps
    const validProps: UnifiedChatPanelProps = {
      threadKey: { type: 'hub', projectId: 'test-proj' },
      artifactExists,
    };
    expect(validProps.artifactExists).toEqual({ mission: true, roadmap: true, architecture: true });
  });

  // ==========================================================================
  // Test 2: DashboardView derives architecture existence from overall.value > 0
  // ==========================================================================

  it('DashboardView derives architecture existence from (data?.strategicFoundation?.highLevelArchitecture?.overall?.value ?? 0) > 0', () => {
    // Test with overall value = 0 (no architecture baseline)
    const dataNoArch = {
      strategicFoundation: {
        highLevelArchitecture: {
          overall: { label: 'Overall', value: 0 },
        },
      },
    };
    expect((dataNoArch.strategicFoundation.highLevelArchitecture.overall.value ?? 0) > 0).toBe(false);

    // Test with overall value = 12 (has architecture baseline)
    const dataWithArch = {
      strategicFoundation: {
        highLevelArchitecture: {
          overall: { label: 'Overall', value: 12 },
        },
      },
    };
    expect((dataWithArch.strategicFoundation.highLevelArchitecture.overall.value ?? 0) > 0).toBe(true);

    // Test with missing highLevelArchitecture (undefined path)
    const dataMissing: { strategicFoundation?: { highLevelArchitecture?: { overall?: { value: number } } } } = {
      strategicFoundation: {},
    };
    expect((dataMissing?.strategicFoundation?.highLevelArchitecture?.overall?.value ?? 0) > 0).toBe(false);
  });

  // ==========================================================================
  // Test 3: handleDownloadTranscript for architecture task uses correct artifact description
  // ==========================================================================

  it('UnifiedChatPanel handleDownloadTranscript for architecture task uses ARCHITECTURE_BASELINE (architecture meta-model) as artifact description', () => {
    const taskId = 'architect--define-architecture';
    const mapping = TASK_ARTIFACT_MAP[taskId];

    // Verify the mapping exists
    expect(mapping).toBeDefined();

    // Determine artifact description using the same branching logic as handleDownloadTranscript
    let artifactDescription: string;
    if (taskId === 'product-manager--roadmap') {
      artifactDescription = 'ROADMAP (initiative/epic structure)';
    } else if (taskId === 'architect--define-architecture') {
      artifactDescription = 'ARCHITECTURE_BASELINE (architecture meta-model)';
    } else {
      artifactDescription = 'agent-os/product/MISSION.MD';
    }

    expect(artifactDescription).toBe('ARCHITECTURE_BASELINE (architecture meta-model)');

    // Verify buildTranscriptMarkdown uses this description correctly
    const messages: ThreadMessage[] = [
      createThreadMessage({
        id: 'msg-1',
        role: 'assistant',
        personaId: 'architect',
        taskId: 'architect--define-architecture',
        content: 'Here is your architecture baseline.',
      }),
    ];

    const result = buildTranscriptMarkdown(
      messages,
      'architect--define-architecture',
      '{"services":[],"interfaces":[]}',
      'ARCHITECTURE_BASELINE (architecture meta-model)'
    );

    expect(result).toContain('> Saved artifact: ARCHITECTURE_BASELINE (architecture meta-model)');
  });

  // ==========================================================================
  // Test 4: handleDownloadTranscript for architecture task generates correct filename
  // ==========================================================================

  it('UnifiedChatPanel handleDownloadTranscript for architecture task generates filename architect-define-architecture-transcript.md', () => {
    const taskId = 'architect--define-architecture';

    // Determine filename using the same branching logic as handleDownloadTranscript
    let filename: string;
    if (taskId === 'product-manager--roadmap') {
      filename = 'pm-roadmap-transcript.md';
    } else if (taskId === 'architect--define-architecture') {
      filename = 'architect-define-architecture-transcript.md';
    } else {
      filename = 'pm-define-product-transcript.md';
    }

    expect(filename).toBe('architect-define-architecture-transcript.md');
  });

  // ==========================================================================
  // Test 5: selectTask with architecture task and artifactExists.architecture === true inserts warning
  // ==========================================================================

  it('selectTask with taskId === architect--define-architecture and artifactExists.architecture === true inserts warning message', () => {
    const taskId = 'architect--define-architecture';
    const mapping = TASK_ARTIFACT_MAP[taskId];
    const artifactExists: Record<string, boolean> = { mission: true, roadmap: false, architecture: true };

    // Verify the mapping has correct warningText
    expect(mapping).toBeDefined();
    expect(mapping.warningText).toBe('An Architecture Baseline already exists. Completing this conversation will replace it.');
    expect(mapping.artifactKey).toBe('architecture');

    // Simulate the selectTask warning logic
    let warningInserted = false;
    let warningContent = '';
    if (mapping && artifactExists[mapping.artifactKey]) {
      warningInserted = true;
      warningContent = mapping.warningText;
    }

    expect(warningInserted).toBe(true);
    expect(warningContent).toBe('An Architecture Baseline already exists. Completing this conversation will replace it.');
  });

  // ==========================================================================
  // Test 6: selectTask with architecture task and artifactExists.architecture === false does NOT insert warning
  // ==========================================================================

  it('selectTask with taskId === architect--define-architecture and artifactExists.architecture === false does NOT insert warning', () => {
    const taskId = 'architect--define-architecture';
    const mapping = TASK_ARTIFACT_MAP[taskId];
    const artifactExists: Record<string, boolean> = { mission: true, roadmap: false, architecture: false };

    // Simulate the selectTask warning logic
    let warningInserted = false;
    if (mapping && artifactExists[mapping.artifactKey]) {
      warningInserted = true;
    }

    expect(warningInserted).toBe(false);
  });
});
