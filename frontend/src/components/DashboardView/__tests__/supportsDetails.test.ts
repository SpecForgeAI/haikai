import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_DETAIL_TYPES,
  supportsDetails,
} from '../candidateDetailsSupport';

describe('supportsDetails', () => {
  it('returns true for each allowlisted candidate type', () => {
    expect(supportsDetails('endpoints')).toBe(true);
    expect(supportsDetails('interfaces')).toBe(true);
    expect(supportsDetails('logical_data_entities')).toBe(true);
    expect(supportsDetails('interface_logical_entities')).toBe(true);
    // Spec 2026-05-29 Task Group 4.2: endpoint->data-effect edge candidate.
    expect(supportsDetails('endpoint_data_effects')).toBe(true);
    // Spec 2026-05-29 (Gap C) Task Group 3.2: behaviour-block details surface.
    expect(supportsDetails('business_logics')).toBe(true);
    // Spec 2026-05-30 (Spec 4) Task Group 7.2: SOAP message FIELD rows.
    expect(supportsDetails('logical_data_attributes')).toBe(true);
  });

  it('returns false for non-allowlisted candidate types', () => {
    expect(supportsDetails('clusters')).toBe(false);
    expect(supportsDetails('services')).toBe(false);
  });

  it('returns false for empty / undefined-ish input', () => {
    expect(supportsDetails('')).toBe(false);
    expect(supportsDetails(undefined as unknown as string)).toBe(false);
    expect(supportsDetails(null as unknown as string)).toBe(false);
  });

  it('exposes a ReadonlySet with exactly the allowlisted types', () => {
    // Spec 2026-05-29 Task Group 4.2 added `endpoint_data_effects` (5th type);
    // Spec 2026-05-29 (Gap C) Task Group 3.2 added `business_logics` (6th type);
    // Spec 2026-05-30 (Spec 4) Task Group 7.2 added `logical_data_attributes`
    // (7th type -- the SOAP message FIELD child rows);
    // Spec 2026-05-30 Outbound Integration Graph (Spec #5) Task Group 6 added
    // `data_movements` (8th type);
    // Spec 2026-05-30 Data-Layer Fidelity 2 (Spec #6) Task Group H added
    // `physical_data_attributes` (9th type).
    expect(SUPPORTED_DETAIL_TYPES.size).toBe(9);
    expect(SUPPORTED_DETAIL_TYPES.has('endpoints')).toBe(true);
    expect(SUPPORTED_DETAIL_TYPES.has('interfaces')).toBe(true);
    expect(SUPPORTED_DETAIL_TYPES.has('logical_data_entities')).toBe(true);
    expect(SUPPORTED_DETAIL_TYPES.has('interface_logical_entities')).toBe(true);
    expect(SUPPORTED_DETAIL_TYPES.has('endpoint_data_effects')).toBe(true);
    expect(SUPPORTED_DETAIL_TYPES.has('business_logics')).toBe(true);
    expect(SUPPORTED_DETAIL_TYPES.has('logical_data_attributes')).toBe(true);
    expect(SUPPORTED_DETAIL_TYPES.has('data_movements')).toBe(true);
    expect(SUPPORTED_DETAIL_TYPES.has('physical_data_attributes')).toBe(true);
  });
});
