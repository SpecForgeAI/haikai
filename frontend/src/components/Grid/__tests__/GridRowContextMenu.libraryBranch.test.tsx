/**
 * GridRowContextMenu library-branch test
 *
 * Spec 2026-05-06: Library Discovery Integration -- Task Group 7
 *
 * Verifies that BOTH the Service-row branch and the (new) Library-row
 * branch render the two discovery menu items:
 *   - "Start Discovery Run" (default -> opens preflight)
 *   - "Start Discovery Run (No Libraries)" (bypass -> existing flow)
 *
 * Together with the legacy GridRowContextMenu test (interface row), this
 * exercises all 3 entity-type branches.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GridRowContextMenu } from '../GridRowContextMenu';

// Mock CSS module so class names match property names (identity proxy).
vi.mock('../GridRowContextMenu.module.css', () => ({
  default: new Proxy({}, {
    get: (_t: object, prop: string | symbol) => String(prop),
  }),
}));

describe('GridRowContextMenu -- library-branch (Spec 2026-05-06, Task Group 7)', () => {
  it('Service row renders BOTH discovery items: Start Discovery Run + Start Discovery Run (No Libraries)', () => {
    const onClose = vi.fn();
    const onAddEndpoints = vi.fn();
    const onStartLibraryScan = vi.fn();
    const onStartScanNoLibraries = vi.fn();

    render(
      <GridRowContextMenu
        isOpen
        position={{ x: 100, y: 100 }}
        entityType="services"
        entityId="svc-1"
        entityName="OrderService"
        onClose={onClose}
        onAddEndpointsAndEntities={onAddEndpoints}
        onStartLibraryScan={onStartLibraryScan}
        onStartScanNoLibraries={onStartScanNoLibraries}
      />,
    );

    // Both items present.
    const item1 = screen.getByTestId('grid-row-context-menu-start-discovery-run');
    const item2 = screen.getByTestId('grid-row-context-menu-start-discovery-run-no-libraries');
    expect(item1).toBeInTheDocument();
    expect(item2).toBeInTheDocument();
    expect(item1).toHaveTextContent(/Start Discovery Run$/);
    expect(item2).toHaveTextContent(/No Libraries/);

    // First click -> onStartLibraryScan; second click -> onStartScanNoLibraries.
    fireEvent.click(item1);
    expect(onStartLibraryScan).toHaveBeenCalledTimes(1);

    // Re-render (the previous click closed the menu via onClose); render a fresh menu.
  });

  it('Library row renders BOTH discovery items (NEW BRANCH)', () => {
    const onClose = vi.fn();
    const onAddEndpoints = vi.fn();
    const onStartLibraryScan = vi.fn();
    const onStartScanNoLibraries = vi.fn();

    render(
      <GridRowContextMenu
        isOpen
        position={{ x: 100, y: 100 }}
        entityType="libraries"
        entityId="lib-1"
        entityName="sharedLib"
        onClose={onClose}
        onAddEndpointsAndEntities={onAddEndpoints}
        onStartLibraryScan={onStartLibraryScan}
        onStartScanNoLibraries={onStartScanNoLibraries}
      />,
    );

    expect(screen.getByTestId('grid-row-context-menu-start-discovery-run')).toBeInTheDocument();
    expect(screen.getByTestId('grid-row-context-menu-start-discovery-run-no-libraries')).toBeInTheDocument();

    // Click the "no libraries" item -> onStartScanNoLibraries fires.
    fireEvent.click(screen.getByTestId('grid-row-context-menu-start-discovery-run-no-libraries'));
    expect(onStartScanNoLibraries).toHaveBeenCalledTimes(1);
    expect(onStartLibraryScan).not.toHaveBeenCalled();
  });

  it('falls back to legacy onStartDiscoveryRun when onStartScanNoLibraries is not supplied', () => {
    const onLegacy = vi.fn();

    render(
      <GridRowContextMenu
        isOpen
        position={{ x: 100, y: 100 }}
        entityType="services"
        entityId="svc-1"
        entityName="OrderService"
        onClose={vi.fn()}
        onAddEndpointsAndEntities={vi.fn()}
        onStartDiscoveryRun={onLegacy}
      />,
    );

    fireEvent.click(screen.getByTestId('grid-row-context-menu-start-discovery-run-no-libraries'));
    expect(onLegacy).toHaveBeenCalledTimes(1);
  });
});
