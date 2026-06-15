/**
 * Tests for the `specFileLinker/matcher.ts` module.
 *
 * Spec: 2026-05-17 Spec File Auto-Linking Phase 3, Task Group 3 (sub-task 3.5).
 *
 * Coverage (P-2 priority order: title > base_path > tag; first match wins):
 *  1. Title-exact-match wins (even when a different candidate's basePath
 *     would also match).
 *  2. Base-path-match used when title doesn't match.
 *  3. Tag-name-match used when neither title nor base-path matches.
 *  4. Two candidates match the same title -> competingMatches (ambiguous).
 *  5. No candidates match anywhere -> orphan signal (matched=null, competingMatches=[]).
 *  6. Pre-existing `spec_link` is NOT considered by the matcher itself --
 *     the matcher just returns the match; the orchestrator handles the skip.
 */

import { matchSpecToInterface } from '../services/findings/packFindingScanners/specFileLinker/matcher';
import type { DiscoveryCandidate } from '../types/candidate';

function makeIface(
  id: string,
  name: string,
  data: Record<string, unknown> = {},
): DiscoveryCandidate {
  return {
    id,
    runId: 'run-1',
    candidateType: 'interfaces',
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data,
    synthesizedAt: new Date().toISOString(),
  };
}

describe('specFileLinker/matcher', () => {
  // =========================================================================
  // Test 1: title-exact-match wins over a basePath match.
  // =========================================================================
  it('Test 1: title-exact-match wins even when a different candidate basePath would also match', () => {
    const parsed = {
      info: { title: 'PetStoreApi', version: '1.0.0' },
      paths: {
        '/api/v1/pets': {},
        '/api/v1/pets/{petId}': {},
      },
    };
    const candidates: DiscoveryCandidate[] = [
      makeIface('IF-pet', 'PetStoreApi', { basePath: '/different/path' }),
      makeIface('IF-other', 'OtherApi', { basePath: '/api/v1/pets' }),
    ];

    const out = matchSpecToInterface(
      { parsed, filePath: 'src/main/resources/openapi.yaml' },
      candidates,
    );
    expect(out.matched).not.toBeNull();
    expect(out.matched?.id).toBe('IF-pet');
    expect(out.heuristic).toBe('title');
    expect(out.competingMatches).toEqual([]);
  });

  // =========================================================================
  // Test 2: base-path-match used when title doesn't match.
  // =========================================================================
  it('Test 2: base-path-match wins when no candidate matches by title', () => {
    const parsed = {
      info: { title: 'UnknownTitle', version: '1.0.0' },
      paths: {
        '/api/v1/pets': {},
        '/api/v1/pets/{petId}': {},
        '/api/v1/pets/{petId}/photos': {},
      },
    };
    const candidates: DiscoveryCandidate[] = [
      makeIface('IF-pet', 'PetStoreController', { basePath: '/api/v1/pets' }),
      makeIface('IF-other', 'OtherController', { basePath: '/admin' }),
    ];

    const out = matchSpecToInterface(
      { parsed, filePath: 'src/main/resources/openapi.yaml' },
      candidates,
    );
    expect(out.matched?.id).toBe('IF-pet');
    expect(out.heuristic).toBe('base_path');
    expect(out.competingMatches).toEqual([]);
  });

  // =========================================================================
  // Test 3: tag-name-match used when title + base-path don't match.
  // =========================================================================
  it('Test 3: tag-name-match wins when neither title nor basePath matches any candidate', () => {
    const parsed = {
      info: { title: 'UnknownTitle', version: '1.0.0' },
      paths: { '/api/v1/widgets': {} },
      tags: [{ name: 'pets', description: 'pet ops' }],
    };
    const candidates: DiscoveryCandidate[] = [
      makeIface('IF-pet', 'PetController', {
        basePath: '/other',
        openApiTag: 'pets',
      }),
      makeIface('IF-other', 'OtherController', {
        basePath: '/admin',
        openApiTag: 'admin',
      }),
    ];

    const out = matchSpecToInterface(
      { parsed, filePath: 'src/main/resources/openapi.yaml' },
      candidates,
    );
    expect(out.matched?.id).toBe('IF-pet');
    expect(out.heuristic).toBe('tag');
    expect(out.competingMatches).toEqual([]);
  });

  // =========================================================================
  // Test 4: two candidates match the same title -> ambiguous.
  // =========================================================================
  it('Test 4: two candidates matching the same title produce competingMatches (ambiguous)', () => {
    const parsed = {
      info: { title: 'SharedApiName', version: '1.0.0' },
      paths: { '/x': {} },
    };
    const candidates: DiscoveryCandidate[] = [
      makeIface('IF-a', 'SharedApiName'),
      makeIface('IF-b', 'SharedApiName'),
    ];
    const out = matchSpecToInterface(
      { parsed, filePath: 'src/main/resources/openapi.yaml' },
      candidates,
    );
    expect(out.matched).toBeNull();
    expect(out.competingMatches).toHaveLength(2);
    expect(out.competingMatches.map((c) => c.id).sort()).toEqual(['IF-a', 'IF-b']);
    expect(out.heuristic).toBe('title');
  });

  // =========================================================================
  // Test 5: no candidates match -> orphan signal.
  // =========================================================================
  it('Test 5: no candidates matching at any level produces orphan signal (matched=null, competingMatches=[])', () => {
    const parsed = {
      info: { title: 'NoMatch', version: '1.0.0' },
      paths: { '/api/v1/things': {} },
      tags: [{ name: 'things' }],
    };
    const candidates: DiscoveryCandidate[] = [
      makeIface('IF-x', 'OtherApi', {
        basePath: '/admin',
        openApiTag: 'admin',
      }),
    ];
    const out = matchSpecToInterface(
      { parsed, filePath: 'src/main/resources/openapi.yaml' },
      candidates,
    );
    expect(out.matched).toBeNull();
    expect(out.competingMatches).toEqual([]);
    expect(out.heuristic).toBeNull();
  });

  // =========================================================================
  // Test 6: two candidates match at base_path level -> ambiguous at base_path.
  // =========================================================================
  it('Test 6: two candidates match at the same base_path level -> competingMatches=base_path', () => {
    const parsed = {
      info: { title: 'NoTitleMatch', version: '1.0.0' },
      paths: { '/api/v1/pets': {}, '/api/v1/pets/{petId}': {} },
    };
    const candidates: DiscoveryCandidate[] = [
      makeIface('IF-a', 'A', { basePath: '/api/v1/pets' }),
      makeIface('IF-b', 'B', { basePath: '/api/v1/pets' }),
    ];
    const out = matchSpecToInterface(
      { parsed, filePath: 'src/main/resources/openapi.yaml' },
      candidates,
    );
    expect(out.matched).toBeNull();
    expect(out.competingMatches).toHaveLength(2);
    expect(out.heuristic).toBe('base_path');
  });
});
