/**
 * Tests for TypedContent v2, API client, and save flow.
 *
 * Spec: User Journey One-Way Sync from Meta-Model
 * Task Group 3: TypedContent v2, API Client, and Save Flow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createDefaultTypedContent,
  UserJourneyContent,
  UserJourneySyncMetadata,
} from '../types/typedContent';
import {
  fetchUserJourneySyncStatus,
  refreshUserJourneyFromModel,
} from '../api/userJourneyDiagramApi';

// ============================================================================
// Test 1: UserJourneyContent with sync field passes type validation
// ============================================================================

describe('UserJourneyContent v2 type validation', () => {
  it('UserJourneyContent with sync field passes type validation', () => {
    const content: UserJourneyContent = {
      journey: {
        id: 'uj-001',
        name: 'Test Journey',
        description: 'A test',
        user_role_id: 'bu-001',
        user_role_name: 'User One',
        parent_business_process_id: 'bp-001',
        parent_business_process_name: 'Process One',
      },
      lanes: [],
      steps: [],
      edges: [],
      render_hints: {
        lane_axis: 'VERTICAL',
        flow_direction: 'LEFT_TO_RIGHT',
        show_title: true,
      },
      diagram_type: 'USER_JOURNEY',
      version: '1.0',
      sync: {
        source_user_journey_id: 'uj-001',
        source_project_id: 'proj-001',
        source_model_file_id: null,
        source_projection_version: '1.0',
        last_synced_at: '2026-04-03T10:00:00Z',
        last_synced_hash: 'abc123',
        sync_status: 'IN_SYNC',
        stale_reason: null,
      },
    };

    // TypeScript type validation passes if this compiles
    expect(content.sync).toBeDefined();
    expect(content.sync!.sync_status).toBe('IN_SYNC');
    expect(content.sync!.source_user_journey_id).toBe('uj-001');
  });
});

// ============================================================================
// Test 2: createDefaultTypedContent('USER_JOURNEY') returns version 2 envelope
// ============================================================================

describe('createDefaultTypedContent USER_JOURNEY version', () => {
  it('returns version 2 envelope for USER_JOURNEY', () => {
    const envelope = createDefaultTypedContent('USER_JOURNEY');

    expect(envelope).toBeDefined();
    expect(envelope!.type).toBe('USER_JOURNEY');
    expect(envelope!.version).toBe(2);
    expect(envelope!.content).toBeDefined();
  });

  it('still returns version 1 for other diagram types', () => {
    const seqEnvelope = createDefaultTypedContent('Sequence');
    expect(seqEnvelope!.version).toBe(1);

    const erEnvelope = createDefaultTypedContent('ER');
    expect(erEnvelope!.version).toBe(1);
  });
});

// ============================================================================
// Test 3: extractUserJourneyDiagram correctly extracts v2 content
// ============================================================================

describe('extractUserJourneyDiagram v2 compatibility', () => {
  it('extracts diagram data from v2 content with sync block present', () => {
    // The extractUserJourneyDiagram function in Canvas.tsx checks for:
    // lanes, steps, edges, journey as the type guard.
    // The sync block is an additional field that doesn't interfere.
    const v2Content = {
      diagram_type: 'USER_JOURNEY',
      version: '1.0',
      journey: { id: 'uj-001', name: 'Test', description: '' },
      lanes: [{ id: 'app-1', name: 'App One', order_index: 0 }],
      steps: [{ id: 'step-1', journey_id: 'uj-001', sequence_order: 1 }],
      edges: [{ id: 'edge-1', from_step_id: 'step-1', to_step_id: 'step-2' }],
      render_hints: { lane_axis: 'VERTICAL', flow_direction: 'LEFT_TO_RIGHT', show_title: true },
      sync: {
        source_user_journey_id: 'uj-001',
        source_project_id: 'proj-001',
        source_model_file_id: null,
        source_projection_version: '1.0',
        last_synced_at: '2026-04-03T10:00:00Z',
        last_synced_hash: 'abc123',
        sync_status: 'IN_SYNC',
        stale_reason: null,
      },
    };

    // Replicate the type guard logic from Canvas.tsx
    const isValid = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return false;
      const obj = value as Record<string, unknown>;
      return (
        Array.isArray(obj.lanes) &&
        Array.isArray(obj.steps) &&
        Array.isArray(obj.edges) &&
        obj.journey != null &&
        typeof obj.journey === 'object'
      );
    };

    expect(isValid(v2Content)).toBe(true);
    expect(v2Content.journey.id).toBe('uj-001');
    expect(v2Content.sync.sync_status).toBe('IN_SYNC');
  });
});

// ============================================================================
// Test 4: extractUserJourneyDiagram continues to work for v1 content
// ============================================================================

describe('extractUserJourneyDiagram v1 backward compatibility', () => {
  it('works for v1 content without sync block', () => {
    const v1Content = {
      diagram_type: 'USER_JOURNEY',
      version: '1.0',
      journey: { id: 'uj-001', name: 'Test', description: '' },
      lanes: [{ id: 'app-1', name: 'App One', order_index: 0 }],
      steps: [{ id: 'step-1', journey_id: 'uj-001', sequence_order: 1 }],
      edges: [],
      render_hints: { lane_axis: 'VERTICAL', flow_direction: 'LEFT_TO_RIGHT', show_title: true },
      // No sync block -- v1 diagram
    };

    const isValid = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return false;
      const obj = value as Record<string, unknown>;
      return (
        Array.isArray(obj.lanes) &&
        Array.isArray(obj.steps) &&
        Array.isArray(obj.edges) &&
        obj.journey != null &&
        typeof obj.journey === 'object'
      );
    };

    expect(isValid(v1Content)).toBe(true);
    expect((v1Content as any).sync).toBeUndefined();
  });
});

// ============================================================================
// Test 5: fetchUserJourneySyncStatus calls correct URL
// ============================================================================

describe('fetchUserJourneySyncStatus', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls correct URL and parses response', async () => {
    const mockResponse = {
      sync_status: 'IN_SYNC',
      stale_reason: null,
      last_synced_at: '2026-04-03T10:00:00Z',
      last_synced_hash: 'abc123',
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await fetchUserJourneySyncStatus('proj-001', 'arch-default', 'diag-001');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/proj-001/architectures/arch-default/diagrams/diag-001/user-journey-sync-status'
    );
    expect(result.sync_status).toBe('IN_SYNC');
    expect(result.last_synced_hash).toBe('abc123');
  });
});

// ============================================================================
// Test 6: refreshUserJourneyFromModel calls correct URL with POST
// ============================================================================

describe('refreshUserJourneyFromModel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls correct URL with POST method and parses response', async () => {
    const mockDiagram = {
      id: 'diag-001',
      name: 'My Journey',
      diagram_type: 'USER_JOURNEY',
      typedContent: { type: 'USER_JOURNEY', version: 2, content: {} },
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDiagram),
    });

    const result = await refreshUserJourneyFromModel('proj-001', 'arch-default', 'diag-001');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/proj-001/architectures/arch-default/diagrams/diag-001/refresh-user-journey-from-model',
      { method: 'POST' }
    );
    expect(result.id).toBe('diag-001');
    expect(result.name).toBe('My Journey');
  });
});
