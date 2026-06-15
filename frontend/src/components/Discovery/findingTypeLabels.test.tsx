/**
 * Tests for `findingTypeLabels` (Spec 2026-05-16 Wire Java + Spring + Maven
 * Findings -- Task Group 7.1).
 *
 * Coverage scope (4 focused cases):
 *  - `labelForFindingType` returns the friendly label for a known type.
 *  - `labelForFindingType` returns a title-cased fallback for an unknown
 *    type (no crash, no missing-label warning).
 *  - `labelForFindingType` tolerates null / empty input.
 *  - Render test: FindingsTab row renders the friendly label rather than
 *    the raw `finding_type` string for one of the new Maven finding types.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type {
  DiscoveryFindingDto,
  DiscoveryFindingSearchResponse,
} from '../../api/findingsApi';
import {
  FINDING_TYPE_LABELS,
  labelForFindingType,
} from './findingTypeLabels';

// ============================================================================
// Pure helper coverage
// ============================================================================

describe('labelForFindingType -- known types', () => {
  it('returns the friendly label for a known Maven finding type', () => {
    expect(labelForFindingType('risky_dependency')).toBe('Risky dependency');
    expect(labelForFindingType('java_version_detected')).toBe('Java version detected');
    expect(labelForFindingType('maven_build_plugin_risk')).toBe('Maven build/plugin risk');
  });

  it('returns the friendly label for a known Java / Spring finding type', () => {
    expect(labelForFindingType('raw_sql_detected')).toBe('Raw SQL detected');
    expect(labelForFindingType('spring_xml_bean_wiring')).toBe('Spring XML bean wiring');
    expect(labelForFindingType('stored_procedure_or_jdbc_usage')).toBe(
      'Stored procedure/JDBC usage',
    );
  });

  it('covers the no-usage finding emitted by Wave B Group 4', () => {
    // Predecessor commit emitted `unused_code_endpoint` rather than
    // `endpoint_code_runtime_mismatch`; the label map matches what the
    // backend actually writes.
    expect(labelForFindingType('unused_code_endpoint')).toBe('Unused code endpoint');
  });
});

describe('labelForFindingType -- unknown types', () => {
  it('falls back to a title-cased label for unknown snake_case types', () => {
    expect(labelForFindingType('totally_made_up_type')).toBe('Totally Made Up Type');
  });

  it('returns empty string for null / undefined / empty input', () => {
    expect(labelForFindingType(null)).toBe('');
    expect(labelForFindingType(undefined)).toBe('');
    expect(labelForFindingType('')).toBe('');
    expect(labelForFindingType('   ')).toBe('');
  });
});

describe('FINDING_TYPE_LABELS -- minimum required entries', () => {
  it('contains all 16 new finding types this spec adds', () => {
    const required = [
      // Java
      'raw_sql_detected',
      'hardcoded_endpoint_or_url',
      'legacy_java_api_usage',
      // Spring Classic
      'spring_xml_bean_wiring',
      'legacy_transaction_configuration',
      'security_filter_or_interceptor_detected',
      'scheduled_or_batch_job_detected',
      'stored_procedure_or_jdbc_usage',
      'spring_classic_migration_risk',
      // Source D extension (Wave B Group 4)
      'unused_code_endpoint',
      // Maven
      'java_version_detected',
      'spring_version_detected',
      'risky_dependency',
      'database_driver_detected',
      'maven_build_plugin_risk',
      'dependency_version_conflict',
      'test_build_gap',
    ];
    for (const key of required) {
      expect(FINDING_TYPE_LABELS[key]).toBeDefined();
      expect(FINDING_TYPE_LABELS[key].length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// FindingsTab render coverage -- verify the label appears in the rendered row
// ============================================================================

const mockListFindings = vi.fn();

vi.mock('../../api/findingsApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/findingsApi')>(
    '../../api/findingsApi',
  );
  return {
    ...actual,
    listFindings: (...args: unknown[]) => mockListFindings(...args),
    reviewFinding: vi.fn(),
    updateFinding: vi.fn(),
  };
});

vi.mock('./FindingsTab.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));
vi.mock('./FindingDetailDrawer.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Import AFTER mocks
import { FindingsTab } from './FindingsTab';

function makeFinding(overrides: Partial<DiscoveryFindingDto> = {}): DiscoveryFindingDto {
  return {
    id: 'f-1',
    run_id: 'run-1',
    project_id: 'proj-1',
    architecture_id: 'arch-1',
    finding_type: 'risky_dependency',
    category: 'dependency',
    severity: 'high',
    confidence: 0.9,
    review_status: 'pending_review',
    previous_review_status: null,
    title: 'log4j 1.x flagged',
    summary: 'log4j 1.x is end-of-life.',
    detail_json: null,
    source: 'maven-dependency-pack',
    created_by_stage: 'deterministic_maven_analysis',
    created_at: '2026-05-16T00:00:00Z',
    updated_at: '2026-05-16T00:00:00Z',
    reviewed_at: null,
    reviewer_notes: null,
    links: [],
    ...overrides,
  };
}

function makeResponse(items: DiscoveryFindingDto[]): DiscoveryFindingSearchResponse {
  return { items, total: items.length, page: 0, size: 20 };
}

describe('FindingsTab -- finding_type label rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListFindings.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the friendly label in the row Type column (not the raw snake_case)', async () => {
    const finding = makeFinding();
    // FindingsTab mounts two fetch effects (unfiltered summary + filtered
    // table), so the mock must resolve for every call, not just once.
    mockListFindings.mockResolvedValue(makeResponse([finding]));

    render(
      <FindingsTab
        projectId="proj-1"
        architectureId="arch-1"
        runId="run-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('findings-table')).toBeInTheDocument();
    });

    const row = screen.getByTestId('findings-row');
    // Friendly label is present...
    expect(row).toHaveTextContent('Risky dependency');
    // ...and the raw snake_case is NOT shown anywhere in the row.
    expect(row.textContent).not.toContain('risky_dependency');
  });
});
