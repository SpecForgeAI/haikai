/**
 * Tests for security association levels + value matching (service-level
 * association, 2026-07-19, Spec B of 3): repo-URL normalization collisions,
 * per-level match indexes, service repo matching, and parent-context options.
 */

import { describe, expect, it } from 'vitest';
import type { MetaModel } from '../types/model';
import {
  buildLevelMatchIndex,
  entityOptionsForLevel,
  normalizeRepoUrl,
  resolveAgainstIndex,
} from './securityLevels';

const model = {
  entities: {
    applications: [
      { id: 'app-mrx', name: 'MRX', abbreviation: 'MRX' },
      { id: 'app-hifi', name: 'HiFi', abbreviation: 'HIFI' },
    ],
    app_components: [{ id: 'comp-core', application_id: 'app-mrx', name: 'Core' }],
    services: [
      {
        id: 'svc-pay',
        application_id: 'app-mrx',
        app_component_id: 'comp-core',
        name: 'payments',
        repo_location: 'git@gitlab.example.com:GRH/Payments.git',
      },
      { id: 'svc-web', application_id: 'app-hifi', name: 'web' },
    ],
  },
  relationships: {},
} as unknown as MetaModel;

describe('normalizeRepoUrl', () => {
  it('collides https / ssh / bare forms onto one key', () => {
    const expected = 'gitlab.example.com/grh/payments';
    expect(normalizeRepoUrl('https://gitlab.example.com/GRH/Payments.git')).toBe(expected);
    expect(normalizeRepoUrl('git@gitlab.example.com:grh/payments')).toBe(expected);
    expect(normalizeRepoUrl('ssh://gitlab.example.com/grh/payments/')).toBe(expected);
    expect(normalizeRepoUrl('  ')).toBeNull();
    expect(normalizeRepoUrl(null)).toBeNull();
  });
});

describe('buildLevelMatchIndex + resolveAgainstIndex', () => {
  it('applications match by id/name/abbreviation', () => {
    const index = buildLevelMatchIndex(model, 'application');
    expect(resolveAgainstIndex(index, 'application', 'mrx')).toBe('app-mrx');
    expect(resolveAgainstIndex(index, 'application', 'HIFI')).toBe('app-hifi');
    expect(resolveAgainstIndex(index, 'application', 'nope')).toBeNull();
  });

  it('components match by name; services match by name AND any repo-URL form', () => {
    const compIndex = buildLevelMatchIndex(model, 'application_component');
    expect(resolveAgainstIndex(compIndex, 'application_component', 'Core')).toBe('comp-core');

    const svcIndex = buildLevelMatchIndex(model, 'service');
    expect(resolveAgainstIndex(svcIndex, 'service', 'payments')).toBe('svc-pay');
    // The file's linking value in a DIFFERENT repo-URL form still resolves.
    expect(
      resolveAgainstIndex(svcIndex, 'service', 'https://gitlab.example.com/grh/payments.git'),
    ).toBe('svc-pay');
    expect(resolveAgainstIndex(svcIndex, 'service', 'GRH/other')).toBeNull();
  });
});

describe('entityOptionsForLevel', () => {
  it('services carry parent context (app / component) for disambiguation', () => {
    const options = entityOptionsForLevel(model, 'service');
    expect(options.map((o) => o.name)).toEqual(['payments', 'web']);
    expect(options[0].contextLabel).toBe('MRX / Core');
    expect(options[1].contextLabel).toBe('HiFi');
  });
});
