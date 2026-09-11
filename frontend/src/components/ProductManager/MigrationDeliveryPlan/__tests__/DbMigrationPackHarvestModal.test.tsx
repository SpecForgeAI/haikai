/**
 * DbMigrationPackHarvestModal tests (via the Structural findings panel)
 *
 * Spec 3 — Sybase schema harvest (frontend surface). Focused coverage only:
 *   (a) the "Harvest from source DB" button opens the modal; Test connection
 *       success renders the engine/server version inline;
 *   (b) Harvest & regenerate calls the api with the snake_case body
 *       (architecture_id from the panel's context), closes the modal on
 *       stage 'completed', refetches the findings list, and fires the
 *       parent's onPackRegenerated refresh;
 *   (c) a failed stage stays IN the modal and renders the stage message +
 *       error + the savedBack summary honestly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const PROJECT_ID = 'proj-h-1';
const PACK_ID = 'pack-h-1';
const ARCH_ID = 'arch-h-1';

vi.mock('../DbMigrationPack.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

const mockListFindings = vi.fn();
const mockTestConnection = vi.fn();
const mockRunHarvest = vi.fn();

vi.mock('../../../../api/dbMigrationPackApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/dbMigrationPackApi')
  >('../../../../api/dbMigrationPackApi');
  return {
    ...actual,
    listDbMigrationPackStructuralFindings: (...args: unknown[]) =>
      mockListFindings(...args),
    testDbSourceConnection: (...args: unknown[]) => mockTestConnection(...args),
    runStructuralHarvest: (...args: unknown[]) => mockRunHarvest(...args),
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

function renderPanel(onPackRegenerated?: () => void) {
  return render(
    <DbMigrationPackStructuralFindingsPanel
      projectId={PROJECT_ID}
      packId={PACK_ID}
      architectureId={ARCH_ID}
      onPackRegenerated={onPackRegenerated}
    />,
  );
}

async function openModalAndFillForm() {
  fireEvent.click(await screen.findByTestId('db-pack-harvest-open-button'));
  expect(screen.getByTestId('db-pack-harvest-modal')).toBeInTheDocument();
  fireEvent.change(screen.getByTestId('db-pack-harvest-host'), {
    target: { value: 'db.example.com' },
  });
  fireEvent.change(screen.getByTestId('db-pack-harvest-database'), {
    target: { value: 'proddb' },
  });
  fireEvent.change(screen.getByTestId('db-pack-harvest-username'), {
    target: { value: 'sa' },
  });
  fireEvent.change(screen.getByTestId('db-pack-harvest-password'), {
    target: { value: 'secret' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListFindings.mockResolvedValue({ findings: [OPEN_FINDING] });
});

describe('DbMigrationPackHarvestModal (via the Structural findings panel)', () => {
  it('opens from the header button; Test connection success renders the server version', async () => {
    mockTestConnection.mockResolvedValue({
      success: true,
      engine: 'sybase',
      serverVersion: 'Adaptive Server Enterprise/16.0 SP03',
      driverUsed: 'jtds',
    });
    renderPanel();

    await openModalAndFillForm();
    fireEvent.click(screen.getByTestId('db-pack-harvest-test-button'));

    // camelCase probe body, port left at its 5000 default, driver auto = omitted.
    await waitFor(() =>
      expect(mockTestConnection).toHaveBeenCalledWith(PROJECT_ID, {
        host: 'db.example.com',
        port: 5000,
        databaseName: 'proddb',
        username: 'sa',
        password: 'secret',
        dbEngine: 'sybase',
      }),
    );
    expect(
      await screen.findByTestId('db-pack-harvest-test-result'),
    ).toHaveTextContent('Adaptive Server Enterprise/16.0 SP03');
    // The modal stays open — testing never closes it.
    expect(screen.getByTestId('db-pack-harvest-modal')).toBeInTheDocument();
  });

  it('Harvest & regenerate sends the snake_case body, closes on completed, refetches + refreshes the pack', async () => {
    const onPackRegenerated = vi.fn();
    mockRunHarvest.mockResolvedValue({
      runId: 'run-1',
      stage: 'completed',
      runStatus: 'succeeded',
      savedBack: {
        entitiesCreated: 4,
        entitiesSkipped: 1,
        candidatesCommitted: 2,
      },
      packRegenerated: true,
      findings: [OPEN_FINDING],
    });
    renderPanel(onPackRegenerated);

    await openModalAndFillForm();
    fireEvent.click(screen.getByTestId('db-pack-harvest-run-button'));

    // snake_case body with architecture_id from the panel's context; NO
    // target_architecture_id (none in this mounting context) and NO
    // sybase_driver (auto = omitted).
    await waitFor(() =>
      expect(mockRunHarvest).toHaveBeenCalledWith(PROJECT_ID, {
        architecture_id: ARCH_ID,
        host: 'db.example.com',
        port: 5000,
        database_name: 'proddb',
        username: 'sa',
        password: 'secret',
        db_engine: 'sybase',
      }),
    );

    // Completed: the modal closes, the findings list refetches (initial
    // load + post-harvest), and the parent's pack refresh fires.
    await waitFor(() =>
      expect(
        screen.queryByTestId('db-pack-harvest-modal'),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(mockListFindings).toHaveBeenCalledTimes(2));
    expect(onPackRegenerated).toHaveBeenCalledTimes(1);
  });

  it('a failed stage stays in the modal with the stage message, error, and savedBack summary', async () => {
    const onPackRegenerated = vi.fn();
    mockRunHarvest.mockResolvedValue({
      runId: 'run-2',
      stage: 'regenerate_failed',
      runStatus: 'failed',
      savedBack: {
        entitiesCreated: 5,
        entitiesSkipped: 2,
        candidatesCommitted: 3,
      },
      packRegenerated: false,
      findings: [],
      error: 'Liquibase changelog generation blew up',
    });
    renderPanel(onPackRegenerated);

    await openModalAndFillForm();
    fireEvent.click(screen.getByTestId('db-pack-harvest-run-button'));

    const failure = await screen.findByTestId('db-pack-harvest-failure');
    expect(failure).toHaveTextContent(
      /Model was backfilled but pack regeneration failed — use Regenerate/,
    );
    expect(failure).toHaveTextContent('Liquibase changelog generation blew up');
    expect(
      screen.getByTestId('db-pack-harvest-saved-back'),
    ).toHaveTextContent(
      'Saved back: 5 entities created, 2 skipped, 3 candidates committed.',
    );

    // Honest failure: the modal STAYS open and nothing pretends the pack
    // regenerated.
    expect(screen.getByTestId('db-pack-harvest-modal')).toBeInTheDocument();
    expect(onPackRegenerated).not.toHaveBeenCalled();
  });
});
