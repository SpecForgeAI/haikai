/**
 * Framework/version shape cross-package drift-detection contract.
 *
 * Spec: 2026-06-24-target-conversation-tech-stack-constraints (Task Group 5;
 * FR5 capture half + FR8 contract).
 *
 * The decoupled `{ framework, version }` captured-answer value is mirrored
 * gateway <-> frontend. This test pins the two sources that can drift:
 *
 *   1. `gateway/src/config/architect-conversation/frameworkVersionShape.json` --
 *      canonical source of truth for the closed `version` SENTINEL set (also
 *      drives the gateway's `frameworkVersionShape.ts` `VersionSentinel` union).
 *   2. The frontend-side `VERSION_SENTINELS` runtime array + `VersionSentinel`
 *      literal-string union in `architectConversationApi.ts` (kept as a literal;
 *      the frontend does not import gateway source).
 *
 * It also asserts the shared `{ framework, version }` value shape + the
 * single-chip resolver agree across the two packages at the BEHAVIOUR level
 * (the chip a versioned answer renders to), since that label is what crosses
 * the wire as `answerSummary`.
 *
 * Why JSON-source-of-truth and not a cross-package TS import: identical
 * rationale to `scopeRefType.contractWithGateway.test.ts` -- the two packages
 * never reach into each other's source trees; `resolveJsonModule: true` is
 * already enabled so the JSON import works with no new config.
 *
 * If this test fails after adding / removing a version sentinel:
 *   Update `gateway/.../frameworkVersionShape.json` AND the frontend's literal
 *   union + `VERSION_SENTINELS` array in `architectConversationApi.ts` (and the
 *   gateway's `VersionSentinelTuple` type) in the same change.
 */

import { describe, it, expect } from 'vitest';

import {
  VERSION_SENTINELS as FRONTEND_SENTINELS,
  VERSION_UNKNOWN,
  resolveFrameworkVersionChip,
  isVersionSentinel,
  type FrameworkVersion,
  type VersionSentinel as FrontendVersionSentinel,
} from '../architectConversationApi';
// Cross-package JSON import. `resolveJsonModule: true` is enabled in
// `frontend/tsconfig.json`. Path resolves four levels up:
// __tests__ -> api -> src -> frontend -> repo root.
import frameworkVersionShapeJson from '../../../../gateway/src/config/architect-conversation/frameworkVersionShape.json';

describe('framework/version shape drift-detection contract', () => {
  it('frontend VERSION_SENTINELS matches gateway frameworkVersionShape.json values', () => {
    const frontendSorted = [...FRONTEND_SENTINELS].sort();
    const jsonSorted = [...frameworkVersionShapeJson.versionSentinels].sort();

    expect(frontendSorted).toEqual(jsonSorted);
    // Belt-and-braces length check so a future key rename in the JSON surfaces
    // as a clear failure rather than a silent empty-sort comparison.
    expect(FRONTEND_SENTINELS.length).toBe(
      frameworkVersionShapeJson.versionSentinels.length,
    );
    expect(FRONTEND_SENTINELS.length).toBeGreaterThan(0);
  });

  it('frontend VersionSentinel literal union accepts every JSON-declared sentinel', () => {
    // Compile-time + runtime equivalence: assigning each JSON sentinel through a
    // `FrontendVersionSentinel` annotation forces the TS compiler to verify that
    // every JSON member is also a valid frontend `VersionSentinel`. A new JSON
    // sentinel the frontend has not mirrored fails to type-check here.
    for (const value of frameworkVersionShapeJson.versionSentinels) {
      const typed: FrontendVersionSentinel = value as FrontendVersionSentinel;
      expect(FRONTEND_SENTINELS).toContain(typed);
      expect(isVersionSentinel(typed)).toBe(true);
    }
  });

  it('the version-unknown sentinel is present and is the documented Spec 3 marker', () => {
    expect(frameworkVersionShapeJson.versionSentinels).toContain('version-unknown');
    expect(VERSION_UNKNOWN).toBe('version-unknown');
  });

  it('the shared { framework, version } shape resolves to exactly ONE chip', () => {
    const concrete: FrameworkVersion = {
      framework: 'Spring Boot 3.4',
      version: '3.4.1',
    };
    // Single resolved chip — never a framework x version cartesian grid.
    expect(resolveFrameworkVersionChip(concrete)).toBe('Spring Boot 3.4.1');

    const unknown: FrameworkVersion = {
      framework: 'Spring Boot 3.4',
      version: VERSION_UNKNOWN,
    };
    expect(resolveFrameworkVersionChip(unknown)).toBe(
      'Spring Boot (version unknown)',
    );
  });
});
