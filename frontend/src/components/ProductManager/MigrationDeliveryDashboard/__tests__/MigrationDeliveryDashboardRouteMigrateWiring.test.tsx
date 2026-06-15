/**
 * MigrationDeliveryDashboardRoute -- Migrate scope + baseline wiring
 *
 * Spec: 2026-06-14 Migrate Button + Migration Execution Driver + External
 * Shape-Spec Auto-Answerer (Spec 3 of 4) -- Task Group 6 (route wiring gap).
 *
 * Group 5 left `company` / `project` / `hasActiveCurrentBaseline` as DEFAULTED
 * props on MigrationDeliveryDashboard (empty / empty / false). Without the route
 * supplying real values the live Migrate button posts an EMPTY orchestration
 * scope and can never detect the current baseline client-side. This test asserts
 * the route threads the REAL (non-default) values through:
 *   - `company` = the active project's organisation NAME (getOrganisationById);
 *   - `project` = the active project's name;
 *   - `hasActiveCurrentBaseline` = TRUE iff an active `kind='current'` baseline
 *     exists (mirrors the gateway's `kind='current' AND status='active'` rule).
 * It also asserts the fail-soft default: when NO active current baseline exists,
 * the flag stays FALSE so Migrate remains hard-blocked client-side (the safe
 * default; the gateway re-validates server-side regardless).
 *
 * The MigrationDeliveryDashboard is mocked to a prop-capturing stub so the test
 * targets the route's wiring exactly (not the dashboard's own render).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Router + context hooks the route consumes. useParams returns the
// architecture-scoped route params; the rest are inert.
vi.mock('react-router-dom', () => ({
  useParams: () => ({
    projectId: 'proj-1',
    architectureId: 'arch-c',
    bookId: 'book-1',
  }),
  useNavigate: () => vi.fn(),
}));
vi.mock('../../../../contexts/ArchitectureContext', () => ({
  useArchitectureDispatch: () => vi.fn(),
}));

// The active project supplies the orchestration scope (organisationId + name).
const mockUseProject = vi.fn();
vi.mock('../../../../contexts/ProjectContext', () => ({
  useProject: () => mockUseProject(),
}));

// The epic-decisions summary fetch fires on mount; stub it so the route render
// is offline (it is unrelated to the wiring under test).
vi.mock('../../../../api/migrationDeliveryDashboardApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationDeliveryDashboardApi')
  >('../../../../api/migrationDeliveryDashboardApi');
  return {
    ...actual,
    getMigrationDeliveryDashboard: vi.fn().mockResolvedValue({
      hierarchy: [],
    }),
  };
});

// Capture the props the route passes to MigrationDeliveryDashboard.
const capturedProps: Array<Record<string, unknown>> = [];
vi.mock('../MigrationDeliveryDashboard', () => ({
  MigrationDeliveryDashboard: (props: Record<string, unknown>) => {
    capturedProps.push(props);
    return (
      <div data-testid="mdd-dashboard-stub">
        <span data-testid="cap-company">{String(props.company ?? '')}</span>
        <span data-testid="cap-project">{String(props.project ?? '')}</span>
        <span data-testid="cap-baseline">
          {String(props.hasActiveCurrentBaseline ?? '')}
        </span>
      </div>
    );
  },
}));

import { MigrationDeliveryDashboardRoute } from '../MigrationDeliveryDashboardRoute';
import type { ApiBehaviourBaselineDto } from '../../../../api/apiBehaviourClient';

beforeEach(() => {
  capturedProps.length = 0;
  mockUseProject.mockReset();
});

function baseline(
  partial: Partial<ApiBehaviourBaselineDto>,
): ApiBehaviourBaselineDto {
  return {
    id: 'b-1',
    project_id: 'proj-1',
    architecture_id: 'arch-c',
    name: 'Current baseline',
    status: 'active',
    kind: 'current',
    ...partial,
  } as ApiBehaviourBaselineDto;
}

describe('MigrationDeliveryDashboardRoute -- Migrate scope + baseline wiring (Group 6)', () => {
  it('threads the organisation name, project name, and an ACTIVE current baseline through to the dashboard', async () => {
    mockUseProject.mockReturnValue({
      id: 'proj-1',
      name: 'Order Migration',
      organisationId: 'org-9',
    });
    const getOrganisationByIdFn = vi
      .fn()
      .mockResolvedValue({ id: 'org-9', name: 'Acme Corp' });
    // One active current-state baseline exists -> the flag must be TRUE.
    const listBaselinesFn = vi
      .fn()
      .mockResolvedValue([baseline({ status: 'active', kind: 'current' })]);

    render(
      <MigrationDeliveryDashboardRoute
        getOrganisationByIdFn={getOrganisationByIdFn}
        listBaselinesFn={listBaselinesFn}
      />,
    );

    // The dashboard mounts; the derived scope reaches it (non-default values).
    await waitFor(() =>
      expect(screen.getByTestId('cap-company')).toHaveTextContent('Acme Corp'),
    );
    expect(screen.getByTestId('cap-project')).toHaveTextContent(
      'Order Migration',
    );
    await waitFor(() =>
      expect(screen.getByTestId('cap-baseline')).toHaveTextContent('true'),
    );

    // The organisation NAME was resolved from the active project's org id, and
    // the baseline read was scoped to the architecture with kind='current'.
    expect(getOrganisationByIdFn).toHaveBeenCalledWith('org-9');
    expect(listBaselinesFn).toHaveBeenCalledWith('proj-1', 'arch-c', {
      kind: 'current',
    });

    // The values that actually reached the dashboard are the REAL (non-default)
    // ones -- NOT the '' / '' / false Group-5 defaults.
    const last = capturedProps[capturedProps.length - 1];
    expect(last.company).toBe('Acme Corp');
    expect(last.project).toBe('Order Migration');
    expect(last.hasActiveCurrentBaseline).toBe(true);
  });

  it('keeps hasActiveCurrentBaseline FALSE (safe default) when only a non-active / non-current baseline exists', async () => {
    mockUseProject.mockReturnValue({
      id: 'proj-1',
      name: 'Order Migration',
      organisationId: 'org-9',
    });
    const getOrganisationByIdFn = vi
      .fn()
      .mockResolvedValue({ id: 'org-9', name: 'Acme Corp' });
    // A draft current baseline + an active TARGET baseline -> neither satisfies
    // the kind='current' AND status='active' rule, so the flag stays FALSE.
    const listBaselinesFn = vi
      .fn()
      .mockResolvedValue([
        baseline({ id: 'b-draft', status: 'draft', kind: 'current' }),
        baseline({ id: 'b-target', status: 'active', kind: 'target' }),
      ]);

    render(
      <MigrationDeliveryDashboardRoute
        getOrganisationByIdFn={getOrganisationByIdFn}
        listBaselinesFn={listBaselinesFn}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('cap-company')).toHaveTextContent('Acme Corp'),
    );
    // No ACTIVE current baseline -> Migrate stays hard-blocked client-side.
    await waitFor(() =>
      expect(screen.getByTestId('cap-baseline')).toHaveTextContent('false'),
    );
    const last = capturedProps[capturedProps.length - 1];
    expect(last.hasActiveCurrentBaseline).toBe(false);
    // The scope (company/project) still threads through correctly.
    expect(last.project).toBe('Order Migration');
  });
});
