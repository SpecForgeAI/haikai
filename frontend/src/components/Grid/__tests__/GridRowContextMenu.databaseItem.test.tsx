/**
 * GridRowContextMenu -- Database discovery item + mutual exclusivity.
 *
 * Spec 2026-06-06: a Service whose Core Tech shows a supported database pack
 * (Persistence-Tier parent + PostgreSQL/Sybase) gets a third discovery item,
 * "Start Discovery Run (Database)". The three items are mutually exclusive:
 *   - database service  -> Database enabled, the two code items disabled
 *   - everything else    -> the two code items enabled, Database disabled
 *
 * The `isDatabaseService` flag is computed by the parent (Grid) at right-click
 * time; here we drive it directly and assert the enable/disable + click wiring.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GridRowContextMenu } from '../GridRowContextMenu';

vi.mock('../GridRowContextMenu.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, prop: string | symbol) => String(prop) }),
}));

const ITEM_RUN = 'grid-row-context-menu-start-discovery-run';
const ITEM_NOLIB = 'grid-row-context-menu-start-discovery-run-no-libraries';
const ITEM_DB = 'grid-row-context-menu-start-discovery-run-database';

function renderMenu(
  overrides: Partial<React.ComponentProps<typeof GridRowContextMenu>> = {},
) {
  const props: React.ComponentProps<typeof GridRowContextMenu> = {
    isOpen: true,
    position: { x: 50, y: 50 },
    entityType: 'services',
    entityId: 'svc-1',
    entityName: 'OrdersDb',
    onClose: vi.fn(),
    onAddEndpointsAndEntities: vi.fn(),
    onStartLibraryScan: vi.fn(),
    onStartScanNoLibraries: vi.fn(),
    onStartDatabaseScan: vi.fn(),
    ...overrides,
  };
  render(<GridRowContextMenu {...props} />);
  return props;
}

describe('GridRowContextMenu -- Database discovery item (Spec 2026-06-06)', () => {
  it('renders all three discovery items on a service row', () => {
    renderMenu();
    expect(screen.getByTestId(ITEM_RUN)).toBeInTheDocument();
    expect(screen.getByTestId(ITEM_NOLIB)).toBeInTheDocument();
    expect(screen.getByTestId(ITEM_DB)).toBeInTheDocument();
    expect(screen.getByTestId(ITEM_DB)).toHaveTextContent(/Database/);
  });

  it('database service: Database enabled, the two code items disabled; click fires onStartDatabaseScan', () => {
    const props = renderMenu({ isDatabaseService: true });
    expect(screen.getByTestId(ITEM_RUN)).toBeDisabled();
    expect(screen.getByTestId(ITEM_NOLIB)).toBeDisabled();
    expect(screen.getByTestId(ITEM_DB)).not.toBeDisabled();

    fireEvent.click(screen.getByTestId(ITEM_DB));
    expect(props.onStartDatabaseScan).toHaveBeenCalledTimes(1);
  });

  it('non-database service: the two code items enabled, Database disabled', () => {
    const props = renderMenu({ isDatabaseService: false });
    expect(screen.getByTestId(ITEM_RUN)).not.toBeDisabled();
    expect(screen.getByTestId(ITEM_NOLIB)).not.toBeDisabled();
    expect(screen.getByTestId(ITEM_DB)).toBeDisabled();

    // A disabled button does not dispatch click in jsdom.
    fireEvent.click(screen.getByTestId(ITEM_DB));
    expect(props.onStartDatabaseScan).not.toHaveBeenCalled();

    // ...but the enabled code item still fires.
    fireEvent.click(screen.getByTestId(ITEM_NOLIB));
    expect(props.onStartScanNoLibraries).toHaveBeenCalledTimes(1);
  });

  it('defaults to non-database (Database disabled) when isDatabaseService is omitted', () => {
    renderMenu();
    expect(screen.getByTestId(ITEM_RUN)).not.toBeDisabled();
    expect(screen.getByTestId(ITEM_NOLIB)).not.toBeDisabled();
    expect(screen.getByTestId(ITEM_DB)).toBeDisabled();
  });

  it('on a library row the Database item is always disabled', () => {
    renderMenu({ entityType: 'libraries', entityId: 'lib-1', entityName: 'sharedLib' });
    expect(screen.getByTestId(ITEM_DB)).toBeDisabled();
    expect(screen.getByTestId(ITEM_RUN)).not.toBeDisabled();
  });
});
