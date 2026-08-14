/**
 * Manifest-picker option derivation from the TARGET draft's element inventory
 * (2026-08-14).
 *
 * The live failure this closes: the picker sourced its options from the
 * ArchitectureContext model — the CURRENT-STATE architecture on the
 * target-state page — so every chosen element id failed the AMS ownership
 * validation (`service_element_not_in_architecture`) and no confirmed
 * manifest ever persisted. Options now derive from the TARGET inventory with
 * the SAME Applications/"Services"-type rule as the gateway's
 * scaffold-service reader.
 */
import { describe, it, expect } from 'vitest';
import { targetServicesFromInventory } from '../TargetArchitectureWorkspace';
import type { ElementInventoryResponse } from '../../../api/architecturesApi';

function inventory(): ElementInventoryResponse {
  return {
    domains: [
      {
        name: 'Applications',
        types: [
          {
            name: 'Application Components',
            entityType: 'app_component',
            instances: [{ id: 'comp-1', name: 'HiFi Service Tier' }],
          },
          {
            name: 'Services',
            entityType: 'service',
            instances: [
              { id: 'svc-target-1', name: 'Target Service A' },
              { id: 'svc-target-2', name: 'Archived Service', archived: true },
            ],
          },
          {
            name: 'Interfaces',
            entityType: 'api_interface',
            instances: [{ id: 'if-1', name: 'Lookup Interface' }],
          },
          {
            name: 'Endpoints',
            entityType: 'api_endpoint',
            instances: [{ id: 'ep-1', name: 'GET /things' }],
          },
        ],
      },
      {
        name: 'Data',
        types: [
          {
            name: 'Services', // wrong domain — must NOT leak in
            instances: [{ id: 'data-svc', name: 'Data Domain Service' }],
          },
        ],
      },
    ],
  };
}

describe('targetServicesFromInventory', () => {
  it('selects ONLY Applications-domain Services instances (live, by id+name)', () => {
    expect(targetServicesFromInventory(inventory())).toEqual([
      { id: 'svc-target-1', name: 'Target Service A' },
    ]);
  });

  it('excludes archived services, interfaces, endpoints, components, and other domains', () => {
    const ids = targetServicesFromInventory(inventory()).map((o) => o.id);
    expect(ids).not.toContain('svc-target-2'); // archived
    expect(ids).not.toContain('if-1'); // interface, not a service
    expect(ids).not.toContain('ep-1'); // endpoint
    expect(ids).not.toContain('comp-1'); // component
    expect(ids).not.toContain('data-svc'); // wrong domain
  });

  it('null / empty inventory -> empty options (honest empty picker, no fallback to foreign ids)', () => {
    expect(targetServicesFromInventory(null)).toEqual([]);
    expect(targetServicesFromInventory({ domains: [] })).toEqual([]);
  });
});
