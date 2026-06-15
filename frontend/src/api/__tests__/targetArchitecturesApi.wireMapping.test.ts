/**
 * targetArchitecturesApi wire-shape mapping tests.
 *
 * Pins the contract for `mapTargetArchitectureWireToDto`, which is the
 * boundary that absorbs AMS's `ArchitectureDto`. The mapper now trusts the
 * AMS wire directly for `kind` and `draftState` (the AMS-side `ArchitectureDto`
 * surfaces both fields per the cleanup that removed the v1 shim) and emits
 * `null` rather than a default when the field is absent -- so the UI can
 * detect an older AMS build instead of silently coercing the value.
 *
 * The mapper retains snake_case / camelCase tolerance for `draftState` /
 * `draft_state` because AMS's global SNAKE_CASE Jackson strategy could
 * round-trip the field under either spelling depending on the endpoint.
 *
 * Spec: 2026-05-20 Target Architecture Authoring Flow -- cleanup B.
 */

import { describe, it, expect } from 'vitest';

import { mapTargetArchitectureWireToDto } from '../targetArchitecturesApi';

describe('mapTargetArchitectureWireToDto', () => {
  const baseWire = {
    id: 'arch-1',
    projectId: 'proj-1',
    name: 'A target',
    description: null,
    tags: [],
    archived: false,
    createdAt: '2026-05-20T08:00:00Z',
    updatedAt: '2026-05-20T08:00:00Z',
  };

  it('passes through camelCase kind and draftState from the wire', () => {
    const dto = mapTargetArchitectureWireToDto({
      ...baseWire,
      kind: 'target',
      draftState: 'active',
    });

    expect(dto.kind).toBe('target');
    expect(dto.draftState).toBe('active');
  });

  it('accepts snake_case draft_state and maps it to draftState', () => {
    const dto = mapTargetArchitectureWireToDto({
      ...baseWire,
      kind: 'target',
      draft_state: 'draft',
    });

    expect(dto.kind).toBe('target');
    expect(dto.draftState).toBe('draft');
  });

  it('falls back to null (NOT a default) when kind/draftState are absent', () => {
    // No `kind` or `draftState` / `draft_state` on the wire at all.
    const dto = mapTargetArchitectureWireToDto({ ...baseWire });

    expect(dto.kind).toBeNull();
    expect(dto.draftState).toBeNull();
  });

  it('maps current/active values cleanly', () => {
    const dto = mapTargetArchitectureWireToDto({
      ...baseWire,
      kind: 'current',
      draftState: 'active',
    });

    expect(dto.kind).toBe('current');
    expect(dto.draftState).toBe('active');
  });

  it('returns null for unrecognised kind / draftState rather than coercing', () => {
    const dto = mapTargetArchitectureWireToDto({
      ...baseWire,
      kind: 'bogus' as unknown as 'target',
      draftState: 'bogus' as unknown as 'active',
    });

    expect(dto.kind).toBeNull();
    expect(dto.draftState).toBeNull();
  });
});
