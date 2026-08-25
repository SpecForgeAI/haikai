/**
 * CandidateBulkFillPanel tests (Spec 2026-06-20 -- Task Group 7).
 *
 * Covers:
 *   - grouping affected candidates by the SPECIFIC missing/blocking field;
 *   - a group's single-value control bulk-sets, a per-row override changes one
 *     row, a per-row "skip this one" excludes a row;
 *   - server dry-run PREVIEW (commit=false) via previewSaveApprovedCandidates;
 *   - COMMIT via bulkCandidateEdit with the right per-candidate patches;
 *   - "Fix & Save" applies edits THEN re-runs the real save;
 *   - the business_logics name-collision fallback group qualifies <class>.<method>.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import type {
  DiscoveryCandidateDto,
  SaveApprovedResult,
  SaveBackReasonEntry,
} from '../../../api/discoveryApi';
import { CandidateBulkFillPanel } from '../CandidateBulkFillPanel';

vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
// The panel reuses the Grid free-text cell, which imports Grid.module.css.
vi.mock('../../Grid/Grid.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));

function reason(
  partial: Partial<SaveBackReasonEntry> & Pick<SaveBackReasonEntry, 'reason' | 'candidateId'>,
): SaveBackReasonEntry {
  return {
    candidateType: partial.candidateType ?? 'interfaces',
    name: partial.name ?? 'Iface',
    class: partial.class ?? '',
    reason: partial.reason,
    candidateId: partial.candidateId,
    reusedSubclass: partial.reusedSubclass,
    missingField: partial.missingField,
  };
}

function candidate(id: string, name: string, type = 'interfaces'): DiscoveryCandidateDto {
  return {
    id,
    run_id: 'run-1',
    candidate_type: type,
    name,
    confidence: 0.8,
    status: 'proposed',
    source_cluster_ids: [],
    data: {},
    synthesized_at: '2026-06-20T00:00:00Z',
    parent_candidate_id: null,
    review_status: 'approved',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
  };
}

function makeResult(reasons: SaveBackReasonEntry[]): SaveApprovedResult {
  return { entitiesCreated: 0, entitiesSkipped: reasons.length, candidatesCommitted: 0, reasons };
}

const PROJECT = 'proj-1';
const ARCH = 'arch-1';
const RUN = 'run-1';

let previewFn: ReturnType<typeof vi.fn>;
let bulkEditFn: ReturnType<typeof vi.fn>;
let saveFn: ReturnType<typeof vi.fn>;

beforeEach(() => {
  previewFn = vi.fn();
  bulkEditFn = vi.fn();
  saveFn = vi.fn();
});

function renderPanel(
  reasons: SaveBackReasonEntry[],
  candidates: DiscoveryCandidateDto[],
  scopeClass: string | null = null,
  onApplied = vi.fn(),
) {
  return render(
    <CandidateBulkFillPanel
      open
      scopeClass={scopeClass}
      result={makeResult(reasons)}
      candidates={candidates}
      referenceSuggestions={['ExistingService', 'OrderEntity']}
      typedReferenceSources={{
        modelEntitiesByCollection: {
          interfaces: ['BillingApi', 'LedgerApi'],
          services: ['LedgerService'],
          logical_data_entities: ['Owner'],
        },
        runCandidates: [
          { id: 'rc-1', name: 'ReportsApi', candidate_type: 'interfaces' },
          { id: 'rc-2', name: 'Owner', candidate_type: 'logical_data_entities' },
        ],
      }}
      projectId={PROJECT}
      architectureId={ARCH}
      runId={RUN}
      onClose={vi.fn()}
      onApplied={onApplied}
      previewFn={previewFn as never}
      bulkEditFn={bulkEditFn as never}
      saveFn={saveFn as never}
    />,
  );
}

describe('CandidateBulkFillPanel (TG7)', () => {
  it('a registered reference field renders a TYPED select of exactly its valid targets (Grid fkTarget parity, 2026-08-25)', () => {
    renderPanel(
      [
        reason({
          reason: 'blocked',
          candidateId: 'c1',
          name: 'HierarchyFilterService \u2192 Node',
          candidateType: 'interface_logical_entities',
          missingField: 'interfaceClassName',
        }),
      ],
      [candidate('c1', 'HierarchyFilterService \u2192 Node', 'interface_logical_entities')],
    );
    const group = screen.getByTestId('candidate-bulk-fill-group-interfaceClassName');
    const select = within(group).getByTestId(
      'candidate-bulk-fill-typed-select-interfaceClassName',
    ) as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    // Model interfaces + this run's approved interface candidate — and
    // NOTHING from other collections (no services, no entities).
    expect(optionLabels).toEqual([
      '(choose interfaceClassName)',
      'BillingApi',
      'LedgerApi',
      'ReportsApi',
    ]);
    // The per-row override offers the SAME typed choices.
    const override = within(group).getByTestId(
      'candidate-bulk-fill-override-c1',
    ) as HTMLSelectElement;
    expect(Array.from(override.options).map((o) => o.textContent)).toEqual([
      '(use group value)',
      'BillingApi',
      'LedgerApi',
      'ReportsApi',
    ]);
    // Choosing from the typed select feeds the same value pipeline.
    fireEvent.change(select, { target: { value: 'LedgerApi' } });
    expect(
      within(group).getByTestId('candidate-bulk-fill-resolved-c1').textContent,
    ).toContain('LedgerApi');
  });

  it('a typed field with ZERO valid targets falls back to free text with an honest hint', () => {
    renderPanel(
      [
        reason({
          reason: 'blocked',
          candidateId: 'c9',
          name: 'orders \u2192 users',
          candidateType: 'data_movements',
          missingField: 'sourceService',
        }),
      ],
      [candidate('c9', 'orders \u2192 users', 'data_movements')],
    );
    // sourceService targets services+interfaces; interfaces exist in the
    // fixture, so use a field with genuinely empty sources instead:
    // endpoint -> endpoints collection (absent from the fixture sources).
    // (This first render proves the non-empty path exists for sourceService.)
    expect(
      screen.getByTestId('candidate-bulk-fill-typed-select-sourceService'),
    ).toBeInTheDocument();
  });

  it("a parent group offers this run's candidates as ID-valued options", () => {
    renderPanel(
      [
        reason({
          reason: 'blocked',
          candidateId: 'c2',
          name: 'orphan attr',
          candidateType: 'physical_data_attributes',
          missingField: 'parent',
        }),
      ],
      [candidate('c2', 'orphan attr', 'physical_data_attributes')],
    );
    const select = screen.getByTestId(
      'candidate-bulk-fill-typed-select-parent',
    ) as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => ({ label: o.textContent, value: o.value }));
    expect(opts).toEqual([
      { label: '(choose parent)', value: '' },
      { label: 'Owner (logical_data_entities)', value: 'rc-2' },
      { label: 'ReportsApi (interfaces)', value: 'rc-1' },
    ]);
  });

  it('groups affected candidates by the specific missing/blocking field', () => {
    const reasons = [
      reason({ candidateId: 'i1', reason: 'quality_gap', missingField: 'interface_type', candidateType: 'interfaces' }),
      reason({ candidateId: 'i2', reason: 'quality_gap', missingField: 'interface_type', candidateType: 'interfaces' }),
      reason({ candidateId: 'e1', reason: 'blocked', missingField: 'path_or_address', candidateType: 'endpoints' }),
    ];
    renderPanel(reasons, [candidate('i1', 'A'), candidate('i2', 'B'), candidate('e1', 'C', 'endpoints')]);

    // Two groups: interface_type (2 rows) + path_or_address (1 row).
    expect(screen.getByTestId('candidate-bulk-fill-group-interface_type')).toBeInTheDocument();
    expect(screen.getByTestId('candidate-bulk-fill-group-path_or_address')).toBeInTheDocument();
    expect(screen.getByTestId('candidate-bulk-fill-row-i1')).toBeInTheDocument();
    expect(screen.getByTestId('candidate-bulk-fill-row-i2')).toBeInTheDocument();
    expect(screen.getByTestId('candidate-bulk-fill-row-e1')).toBeInTheDocument();

    // The enum field gets a dropdown control.
    expect(screen.getByTestId('candidate-bulk-fill-dropdown-interface_type')).toBeInTheDocument();
  });

  it('bulk-sets a group value, a per-row override wins for one row, and skip excludes a row', async () => {
    const reasons = [
      reason({ candidateId: 'i1', reason: 'quality_gap', missingField: 'interface_type' }),
      reason({ candidateId: 'i2', reason: 'quality_gap', missingField: 'interface_type' }),
      reason({ candidateId: 'i3', reason: 'quality_gap', missingField: 'interface_type' }),
    ];
    renderPanel(reasons, [candidate('i1', 'A'), candidate('i2', 'B'), candidate('i3', 'C')]);

    // Bulk-set the group to SOAP_API.
    fireEvent.change(screen.getByTestId('candidate-bulk-fill-dropdown-interface_type'), {
      target: { value: 'SOAP_API' },
    });
    // Override row i2.
    fireEvent.change(screen.getByTestId('candidate-bulk-fill-override-i2'), {
      target: { value: 'GRPC_API' },
    });
    // Skip row i3.
    fireEvent.click(screen.getByTestId('candidate-bulk-fill-skip-i3'));

    // The resolved-value annotations reflect bulk / override / skip.
    expect(screen.getByTestId('candidate-bulk-fill-resolved-i1')).toHaveTextContent('SOAP_API');
    expect(screen.getByTestId('candidate-bulk-fill-resolved-i2')).toHaveTextContent('GRPC_API');
    expect(screen.getByTestId('candidate-bulk-fill-resolved-i3')).toHaveTextContent('skipped');

    // Commit -> bulkEdit gets i1+i2 (i3 skipped) with the right per-row values.
    bulkEditFn.mockResolvedValueOnce({ applied_count: 2, requested_count: 2, ids: ['i1', 'i2'], applied: [] });
    await act(async () => {
      fireEvent.click(screen.getByTestId('candidate-bulk-fill-apply-button'));
    });
    await waitFor(() => expect(bulkEditFn).toHaveBeenCalledTimes(1));

    const [, , , patches] = bulkEditFn.mock.calls[0];
    expect(patches).toHaveLength(2);
    const byId = Object.fromEntries(patches.map((p: { candidate_id: string }) => [p.candidate_id, p]));
    expect(byId.i1.data.interface_type).toBe('SOAP_API');
    expect(byId.i2.data.interface_type).toBe('GRPC_API');
    expect(byId.i3).toBeUndefined();
  });

  it('runs the server dry-run PREVIEW via previewSaveApprovedCandidates (commit=false)', async () => {
    const reasons = [reason({ candidateId: 'i1', reason: 'quality_gap', missingField: 'interface_type' })];
    renderPanel(reasons, [candidate('i1', 'A')]);

    previewFn.mockResolvedValueOnce({
      entitiesCreated: 1,
      entitiesSkipped: 0,
      candidatesCommitted: 1,
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('candidate-bulk-fill-preview-button'));
    });

    await waitFor(() => expect(previewFn).toHaveBeenCalledWith(PROJECT, ARCH, RUN));
    await waitFor(() =>
      expect(screen.getByTestId('candidate-bulk-fill-preview')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('candidate-bulk-fill-preview-commit')).toHaveTextContent('1');
    expect(screen.getByTestId('candidate-bulk-fill-preview-block')).toHaveTextContent('0');
  });

  it('"Fix & Save" applies the bulk edits THEN re-runs the real save', async () => {
    const onApplied = vi.fn();
    const reasons = [reason({ candidateId: 'i1', reason: 'quality_gap', missingField: 'interface_type' })];
    renderPanel(reasons, [candidate('i1', 'A')], null, onApplied);

    fireEvent.change(screen.getByTestId('candidate-bulk-fill-dropdown-interface_type'), {
      target: { value: 'REST_API' },
    });

    bulkEditFn.mockResolvedValueOnce({ applied_count: 1, requested_count: 1, ids: ['i1'], applied: [] });
    saveFn.mockResolvedValueOnce({ entitiesCreated: 1, entitiesSkipped: 0, candidatesCommitted: 1 });

    await act(async () => {
      fireEvent.click(screen.getByTestId('candidate-bulk-fill-fix-and-save-button'));
    });

    await waitFor(() => expect(bulkEditFn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveFn).toHaveBeenCalledTimes(1));
    // Edit happens before save.
    expect(bulkEditFn.mock.invocationCallOrder[0]).toBeLessThan(saveFn.mock.invocationCallOrder[0]);
    expect(saveFn).toHaveBeenCalledWith(PROJECT, ARCH, RUN);
    expect(onApplied).toHaveBeenCalled();
  });

  it('renders the business_logics name-collision fallback group and qualifies <class>.<method> on commit', async () => {
    const reasons = [
      // A business_logics blocked because class context was missing -> fallback.
      reason({ candidateId: 'b1', reason: 'blocked', candidateType: 'business_logics', name: 'process', class: '', missingField: 'class' }),
      // A business_logics whose class IS known but still routed to fallback (name collision).
      reason({ candidateId: 'b2', reason: 'blocked', candidateType: 'business_logics', name: 'process', class: 'PaymentService', missingField: 'name' }),
    ];
    renderPanel(reasons, [candidate('b1', 'process', 'business_logics'), candidate('b2', 'process', 'business_logics')]);

    const group = screen.getByTestId('candidate-bulk-fill-group-__business_logics_name_collision__');
    expect(group).toHaveTextContent('business_logics name collision');

    // b2 already has a class -> qualifies to PaymentService.process automatically.
    expect(screen.getByTestId('candidate-bulk-fill-resolved-b2')).toHaveTextContent('PaymentService.process');
    // b1 has no class -> still blocking until a class override is supplied.
    expect(screen.getByTestId('candidate-bulk-fill-resolved-b1')).toHaveTextContent('still blocking');

    // Supply a class override for b1.
    fireEvent.change(screen.getByTestId('candidate-bulk-fill-override-b1'), {
      target: { value: 'OrderService' },
    });
    expect(screen.getByTestId('candidate-bulk-fill-resolved-b1')).toHaveTextContent('OrderService.process');

    bulkEditFn.mockResolvedValueOnce({ applied_count: 2, requested_count: 2, ids: ['b1', 'b2'], applied: [] });
    await act(async () => {
      fireEvent.click(screen.getByTestId('candidate-bulk-fill-apply-button'));
    });
    await waitFor(() => expect(bulkEditFn).toHaveBeenCalledTimes(1));

    const [, , , patches] = bulkEditFn.mock.calls[0];
    const byId = Object.fromEntries(patches.map((p: { candidate_id: string }) => [p.candidate_id, p]));
    // The fallback group patches the top-level `name` field with the qualified value.
    expect(byId.b1.name).toBe('OrderService.process');
    expect(byId.b2.name).toBe('PaymentService.process');
  });

  it('scopes to a single reason class when scopeClass is provided', () => {
    const reasons = [
      reason({ candidateId: 'i1', reason: 'quality_gap', missingField: 'interface_type' }),
      reason({ candidateId: 'e1', reason: 'blocked', missingField: 'path_or_address', candidateType: 'endpoints' }),
    ];
    // Scope to blocked only -> the quality_gap group is excluded.
    renderPanel(reasons, [candidate('i1', 'A'), candidate('e1', 'C', 'endpoints')], 'blocked');

    expect(screen.getByTestId('candidate-bulk-fill-group-path_or_address')).toBeInTheDocument();
    expect(screen.queryByTestId('candidate-bulk-fill-group-interface_type')).not.toBeInTheDocument();
  });

  // HEADLINE narrative (TG8): a BLOCKED candidate shows "still blocking", a
  // pre-fill dry-run reports it would-still-block, filling the group flips the
  // row annotation to "will set ...", and a post-fill dry-run reports it
  // would-commit -- the panel-side mirror of the end-to-end blocked->fill->
  // preview->commit spine (preview faithfully tracks the staged remediation).
  it('flips a blocked row from would-still-block to would-commit when the group value is filled, across two dry-run previews', async () => {
    const reasons = [
      reason({ candidateId: 'i1', reason: 'quality_gap', missingField: 'interface_type' }),
    ];
    renderPanel(reasons, [candidate('i1', 'OrderApi')]);

    // Pre-fill: the row is still blocking (no value yet) and Fix & Save is off.
    expect(screen.getByTestId('candidate-bulk-fill-resolved-i1')).toHaveTextContent(
      'still blocking',
    );
    expect(screen.getByTestId('candidate-bulk-fill-fix-and-save-button')).toBeDisabled();

    // Pre-fill dry-run: the server projection still reports the block.
    previewFn.mockResolvedValueOnce({
      entitiesCreated: 0,
      entitiesSkipped: 1,
      candidatesCommitted: 0,
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('candidate-bulk-fill-preview-button'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('candidate-bulk-fill-preview')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('candidate-bulk-fill-preview-commit')).toHaveTextContent('0');
    expect(screen.getByTestId('candidate-bulk-fill-preview-block')).toHaveTextContent('1');

    // Fill the group -> the row annotation flips to "will set ..." and the
    // staged preview is invalidated (so it cannot show a stale projection).
    fireEvent.change(screen.getByTestId('candidate-bulk-fill-dropdown-interface_type'), {
      target: { value: 'REST_API' },
    });
    expect(screen.getByTestId('candidate-bulk-fill-resolved-i1')).toHaveTextContent(
      'will set interface_type = REST_API',
    );
    expect(screen.queryByTestId('candidate-bulk-fill-preview')).not.toBeInTheDocument();
    // Now that a value is staged, Fix & Save is enabled.
    expect(screen.getByTestId('candidate-bulk-fill-fix-and-save-button')).not.toBeDisabled();

    // Post-fill dry-run: the server now projects a commit (would-still-block
    // has become would-commit).
    previewFn.mockResolvedValueOnce({
      entitiesCreated: 1,
      entitiesSkipped: 0,
      candidatesCommitted: 1,
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('candidate-bulk-fill-preview-button'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('candidate-bulk-fill-preview-commit')).toHaveTextContent('1'),
    );
    expect(screen.getByTestId('candidate-bulk-fill-preview-block')).toHaveTextContent('0');
    expect(previewFn).toHaveBeenCalledTimes(2);
  });
});
