/**
 * DbMigrationPackStructuralFindingsPanel tests
 *
 * Spec 2026-08-04-2 — Structural findings dispositions (frontend surface).
 *
 * Focused coverage only:
 *   (a) the panel renders one row per finding (message, status chip, note)
 *       plus the "Open findings block plan generation and Migrate." banner
 *       while any finding is open;
 *   (b) Accept requires a reason — the disposition call NEVER fires without
 *       one; with a reason it fires with disposition 'accepted' + the note +
 *       the finding's kind/subject, then the list refetches;
 *   (c) Fix upstream fires immediately (no note) and Clear disposition fires
 *       the delete;
 *   (d) zero findings renders NOTHING.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const PROJECT_ID = 'proj-sf-1';
const PACK_ID = 'pack-sf-1';
const ARCH_ID = 'arch-sf-1';

vi.mock('../DbMigrationPack.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

const mockListFindings = vi.fn();
const mockSetDisposition = vi.fn();
const mockClearDisposition = vi.fn();

vi.mock('../../../../api/dbMigrationPackApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/dbMigrationPackApi')
  >('../../../../api/dbMigrationPackApi');
  return {
    ...actual,
    listDbMigrationPackStructuralFindings: (...args: unknown[]) =>
      mockListFindings(...args),
    setDbMigrationPackStructuralFindingDisposition: (...args: unknown[]) =>
      mockSetDisposition(...args),
    clearDbMigrationPackStructuralFindingDisposition: (...args: unknown[]) =>
      mockClearDisposition(...args),
  };
});

import DbMigrationPackStructuralFindingsPanel from '../DbMigrationPackStructuralFindingsPanel';
import type { DbMigrationPackStructuralFinding } from '../../../../api/dbMigrationPackApi';

const OPEN_FINDING: DbMigrationPackStructuralFinding = {
  key: 'no_primary_keys:all_tables',
  kind: 'no_primary_keys',
  subject: 'all_tables',
  message: 'No primary keys captured across any table — suspicious zero.',
  disposition: null,
  note: null,
  open: true,
};

const KNOWN_GAP_FINDING: DbMigrationPackStructuralFinding = {
  key: 'no_foreign_keys:all_tables',
  kind: 'no_foreign_keys',
  subject: 'all_tables',
  message: 'No foreign keys captured.',
  disposition: 'known_gap',
  note: 'Source schema genuinely has no declared FKs; app-enforced.',
  open: false,
};

function renderPanel() {
  return render(
    <DbMigrationPackStructuralFindingsPanel
      projectId={PROJECT_ID}
      packId={PACK_ID}
      architectureId={ARCH_ID}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DbMigrationPackStructuralFindingsPanel', () => {
  it('renders a row per finding with status chips, the note, and the open-findings banner', async () => {
    mockListFindings.mockResolvedValue({
      findings: [OPEN_FINDING, KNOWN_GAP_FINDING],
    });
    renderPanel();

    expect(
      await screen.findByTestId('db-pack-structural-findings'),
    ).toBeInTheDocument();
    expect(mockListFindings).toHaveBeenCalledWith(PROJECT_ID, PACK_ID);

    // Row 1: undispositioned — Open chip.
    expect(
      screen.getByTestId(`db-pack-structural-finding-status-${OPEN_FINDING.key}`),
    ).toHaveTextContent('Open');
    expect(
      screen.getByText(/No primary keys captured across any table/),
    ).toBeInTheDocument();

    // Row 2: known_gap — chip + persisted note.
    expect(
      screen.getByTestId(
        `db-pack-structural-finding-status-${KNOWN_GAP_FINDING.key}`,
      ),
    ).toHaveTextContent('Known gap');
    expect(
      screen.getByTestId(
        `db-pack-structural-finding-note-${KNOWN_GAP_FINDING.key}`,
      ),
    ).toHaveTextContent('app-enforced');

    // Any open finding shows the blocking banner.
    expect(
      screen.getByTestId('db-pack-structural-findings-open-banner'),
    ).toHaveTextContent('Open findings block plan generation and Migrate.');

    // Only the dispositioned row offers Clear disposition.
    expect(
      screen.queryByTestId(
        `db-pack-structural-finding-clear-${OPEN_FINDING.key}`,
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(
        `db-pack-structural-finding-clear-${KNOWN_GAP_FINDING.key}`,
      ),
    ).toBeInTheDocument();
  });

  it('Accept requires a reason before the disposition call fires, then refetches', async () => {
    mockListFindings.mockResolvedValue({ findings: [OPEN_FINDING] });
    mockSetDisposition.mockResolvedValue({
      finding_key: OPEN_FINDING.key,
      disposition: 'accepted',
      note: 'Verified against the source DDL.',
    });
    renderPanel();

    fireEvent.click(
      await screen.findByTestId(
        `db-pack-structural-finding-accept-${OPEN_FINDING.key}`,
      ),
    );

    // Confirming with an EMPTY reason never fires the call.
    fireEvent.click(
      screen.getByTestId(
        `db-pack-structural-finding-note-confirm-${OPEN_FINDING.key}`,
      ),
    );
    expect(mockSetDisposition).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('db-pack-structural-findings-error'),
    ).toHaveTextContent(/reason is required/i);

    // With a reason the call fires with the note + kind/subject from the row.
    fireEvent.change(
      screen.getByTestId(
        `db-pack-structural-finding-note-input-${OPEN_FINDING.key}`,
      ),
      { target: { value: 'Verified against the source DDL.' } },
    );
    fireEvent.click(
      screen.getByTestId(
        `db-pack-structural-finding-note-confirm-${OPEN_FINDING.key}`,
      ),
    );

    await waitFor(() =>
      expect(mockSetDisposition).toHaveBeenCalledWith(
        PROJECT_ID,
        PACK_ID,
        expect.objectContaining({
          key: OPEN_FINDING.key,
          kind: 'no_primary_keys',
          subject: 'all_tables',
        }),
        'accepted',
        'Verified against the source DDL.',
      ),
    );
    // After the action the merged list refetches (initial load + 1).
    await waitFor(() => expect(mockListFindings).toHaveBeenCalledTimes(2));
  });

  it('Fix upstream fires without a note; Clear disposition fires the delete', async () => {
    mockListFindings.mockResolvedValue({
      findings: [OPEN_FINDING, KNOWN_GAP_FINDING],
    });
    mockSetDisposition.mockResolvedValue({
      finding_key: OPEN_FINDING.key,
      disposition: 'fix_upstream',
    });
    mockClearDisposition.mockResolvedValue(undefined);
    renderPanel();

    fireEvent.click(
      await screen.findByTestId(
        `db-pack-structural-finding-fix-upstream-${OPEN_FINDING.key}`,
      ),
    );
    await waitFor(() =>
      expect(mockSetDisposition).toHaveBeenCalledWith(
        PROJECT_ID,
        PACK_ID,
        expect.objectContaining({ key: OPEN_FINDING.key }),
        'fix_upstream',
        undefined,
      ),
    );

    fireEvent.click(
      screen.getByTestId(
        `db-pack-structural-finding-clear-${KNOWN_GAP_FINDING.key}`,
      ),
    );
    await waitFor(() =>
      expect(mockClearDisposition).toHaveBeenCalledWith(
        PROJECT_ID,
        PACK_ID,
        KNOWN_GAP_FINDING.key,
      ),
    );
  });

  it('zero findings still renders the section with an ENABLED harvest button (2026-08-12)', async () => {
    // The old zero-findings-renders-nothing behaviour HID the harvest — but
    // a clean-looking pack is exactly when a live-catalog fidelity re-read
    // (widths / nullability / keys) may be needed. Staleness-is-a-signal
    // ruling: the button is never disabled by finding state.
    mockListFindings.mockResolvedValue({ findings: [] });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId('db-pack-structural-findings')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('db-pack-structural-findings-empty')).toBeInTheDocument();
    expect(screen.getByTestId('db-pack-harvest-open-button')).toBeEnabled();
  });

  it('the harvest button stays ENABLED when every finding is dispositioned (the live disabled-button bug)', async () => {
    mockListFindings.mockResolvedValue({ findings: [KNOWN_GAP_FINDING] });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId('db-pack-harvest-open-button')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('db-pack-harvest-open-button')).toBeEnabled();
  });

  it('details expander lists the itemised affected pairs (partial-coverage follow-up)', async () => {
    const withDetails: DbMigrationPackStructuralFinding = {
      ...OPEN_FINDING,
      key: 'relationships_without_fk_columns:all_relationships',
      kind: 'relationships_without_fk_columns',
      subject: 'all_relationships',
      message:
        '17 of 62 relationship(s) carry no fk_columns join metadata — those 17 FK(s) will be silently absent.',
      details: ['dbo.orders -> dbo.customers', 'dbo.items -> dbo.orders'],
    };
    mockListFindings.mockResolvedValue({ findings: [withDetails] });
    renderPanel();

    const toggle = await screen.findByTestId(
      `db-pack-structural-finding-details-toggle-${withDetails.key}`,
    );
    expect(toggle).toHaveTextContent('Show 2 affected');
    // Collapsed by default.
    expect(
      screen.queryByTestId(`db-pack-structural-finding-details-${withDetails.key}`),
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);
    const list = screen.getByTestId(
      `db-pack-structural-finding-details-${withDetails.key}`,
    );
    expect(list).toHaveTextContent('dbo.orders -> dbo.customers');
    expect(list).toHaveTextContent('dbo.items -> dbo.orders');
    expect(toggle).toHaveTextContent('Hide affected');

    fireEvent.click(toggle);
    expect(
      screen.queryByTestId(`db-pack-structural-finding-details-${withDetails.key}`),
    ).not.toBeInTheDocument();
  });
  it('keeps "Fix with AI" available on known_gap rows of eligible kinds; drops it only on accepted (2026-08-08)', async () => {
    mockListFindings.mockResolvedValue({
      findings: [
        {
          key: 'no_primary_keys:all_tables',
          kind: 'no_primary_keys',
          subject: 'all_tables',
          message: '57 of 65 table(s) carry no primary key.',
          disposition: 'known_gap',
          note: 'Please add PK in target',
          open: false,
        },
        {
          key: 'relationships_without_fk_columns:all',
          kind: 'relationships_without_fk_columns',
          subject: 'all',
          message: '12 relationship(s) carry no fk_columns join metadata.',
          disposition: 'accepted',
          note: 'Genuinely joinless.',
          open: false,
        },
      ],
    });
    renderPanel();
    // known_gap keeps the intelligent-fix affordance (accepted debt is
    // exactly the row an operator comes back to fix).
    expect(
      await screen.findByTestId('db-gap-proposals-draft-no_primary_keys:all_tables'),
    ).toBeInTheDocument();
    // accepted = "the zero is genuinely true" — no fix offered.
    expect(
      screen.queryByTestId('db-gap-proposals-draft-relationships_without_fk_columns:all'),
    ).toBeNull();
  });
});

