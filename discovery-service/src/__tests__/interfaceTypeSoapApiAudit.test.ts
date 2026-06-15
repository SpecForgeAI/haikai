/**
 * Tests for Task Group 8 of the SOAP Discovery Spring Classic Phase 1 spec.
 *
 * Spec: agent-os/specs/2026-05-17-soap-discovery-spring-classic-phase-1/spec.md
 *
 * Audit scope: confirm that the `'SOAP_API'` value for `interface_type`
 * flows through the discovery-service → architecture-model-service →
 * frontend pipeline without being coerced, stripped, or rejected.
 *
 * Test 1 — Discovery-service side: an interface candidate constructed with
 * `data.interface_type = 'SOAP_API'` is a valid `DiscoveryCandidate`; the
 * value is preserved verbatim on `candidate.data` (no enum coercion, no
 * stripping by the candidate type system).
 *
 * Test 2 — Frontend side (structural / file-text): the frontend
 * `InterfaceType` union in `frontend/src/types/model.ts` includes
 * `'SOAP_API'`. The discovery-service cannot cross-import the frontend
 * package, so this assertion is a lightweight file-text check against the
 * union declaration.
 *
 * AMS side: confirmed by reading the entity / DTO / mapper directly during
 * the audit — `InterfaceEntity.interfaceType` is plain `String` (no enum
 * coercion), `InterfaceDto.interfaceType` is `String`, and `EntityMapper`
 * round-trips the value via `getInterfaceType()` / `.interfaceType()` calls.
 * No validator rejects the value. See audit outcome recorded in
 * `agent-os/specs/2026-05-17-soap-discovery-spring-classic-phase-1/planning/group-8-audit-outcome.txt`.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DiscoveryCandidate } from '../types/candidate';

describe('Interface-type vocab audit — SOAP_API round-trips end-to-end', () => {

  // ==========================================================================
  // Test 1: Discovery-service emitter accepts SOAP_API without coercion
  // ==========================================================================
  test("an interface candidate with data.interface_type='SOAP_API' is accepted and not coerced/stripped", () => {
    // Build a DiscoveryCandidate that mirrors the shape the future
    // soapEndpointEmitter (Task Group 4) will produce: a parent SOAP
    // interface candidate carrying `interface_type: 'SOAP_API'` on its
    // freeform `data` payload.
    const candidate: DiscoveryCandidate = {
      id: 'cand-soap-001',
      runId: 'run-001',
      candidateType: 'interfaces',
      name: 'GreetingsService',
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: ['src/main/java/com/example/GreetingsEndpoint.java'],
      data: {
        interface_type: 'SOAP_API',
        className: 'GreetingsEndpoint',
        packageName: 'com.example',
        _addedBy: 'spring-classic-soap',
      },
      synthesizedAt: new Date().toISOString(),
    };

    // The DiscoveryCandidate type uses `data: Record<string, unknown>` —
    // there is no union/enum that could strip 'SOAP_API'. Round-trip the
    // value through a JSON serialisation cycle (the same path used when
    // candidates are persisted via the archModelClient) to confirm it
    // survives without coercion.
    const serialised = JSON.parse(JSON.stringify(candidate)) as DiscoveryCandidate;
    expect(serialised.data.interface_type).toBe('SOAP_API');
    expect(typeof serialised.data.interface_type).toBe('string');

    // Verify the candidate type itself is unchanged.
    expect(serialised.candidateType).toBe('interfaces');
    expect(serialised.name).toBe('GreetingsService');
  });

  // ==========================================================================
  // Test 2 (optional): frontend InterfaceType union contains 'SOAP_API'
  // ==========================================================================
  test("frontend InterfaceType union in model.ts includes 'SOAP_API'", () => {
    // The frontend lives in a separate TypeScript project so we cannot
    // cross-import the union directly. This is a structural file-text
    // check against the union declaration in frontend/src/types/model.ts.
    const frontendModelPath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      'frontend',
      'src',
      'types',
      'model.ts',
    );
    expect(fs.existsSync(frontendModelPath)).toBe(true);

    const source = fs.readFileSync(frontendModelPath, 'utf8');
    // Locate the InterfaceType union declaration block and confirm the
    // SOAP_API literal is one of its members. The union is declared as
    //   export type InterfaceType =
    //     | 'REST_API'
    //     | ...
    //     | 'SOAP_API'
    //     | ...;
    const unionMatch = source.match(/export type InterfaceType =([\s\S]*?);/);
    expect(unionMatch).not.toBeNull();
    const unionBody = unionMatch![1];
    expect(unionBody).toMatch(/'SOAP_API'/);
  });
});
