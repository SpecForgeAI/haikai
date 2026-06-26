/**
 * Tests for the confirmed-manifest READ half of `targetManifestApi`.
 *
 * Spec: Confirmed Manifest Producer Wiring (2026-06-25, Spec 5 Phase 2) —
 * frontend closeout follow-up. Focused coverage of the two pieces the Migration
 * Delivery Plan wizard's Stage-7 "Manifest Uploaded" line depends on:
 *
 *   - `fetchLatestTargetManifests` maps the gateway READ-proxy snake_case rows
 *     (`manifest_path` / `tag` / `kind`) to the compact `{ manifestPath, tag,
 *     kind }` shape, and is FAIL-SOFT — a non-2xx response, a non-array body, OR
 *     a network throw all RESOLVE to `[]` (never throw into the wizard);
 *   - `formatLatestTargetManifestLabel` formats one row as `"<filename> (<tag>)"`,
 *     deriving the filename from the path basename or, when the path is empty,
 *     from the persisted `kind` (`maven_pom` -> `pom.xml`, `npm_package` ->
 *     `package.json`).
 *
 * The fetch-stubbing harness mirrors `vulnerabilitiesApi.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchLatestTargetManifests,
  formatLatestTargetManifestLabel,
  resolvedTargetVersionChip,
  type LatestTargetManifest,
  type ResolvedTargetVersion,
} from './targetManifestApi';

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';

/** A snake_case manifest-artifacts row as the gateway READ proxy passes it through. */
function wireRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'row-1',
    project_id: PROJECT_ID,
    target_architecture_id: ARCH_ID,
    tag: 'orders-service',
    kind: 'maven_pom',
    ecosystem: 'MAVEN',
    manifest_path: 'services/orders/pom.xml',
    content: '<project/>\n',
    package_lock_content: null,
    resolved_dependencies: [],
    is_latest: true,
    created_at: '2026-06-25T00:00:00Z',
    ...overrides,
  };
}

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
  };
}

describe('targetManifestApi — fetchLatestTargetManifests', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetAllMocks();
  });

  it('maps the snake_case rows to the compact { manifestPath, tag, kind } shape', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      okJson([
        wireRow(),
        wireRow({
          tag: 'web-bff',
          kind: 'npm_package',
          manifest_path: 'apps/web-bff/package.json',
        }),
      ])
    );

    const rows = await fetchLatestTargetManifests(PROJECT_ID, ARCH_ID);

    expect(rows).toEqual([
      { manifestPath: 'services/orders/pom.xml', tag: 'orders-service', kind: 'maven_pom' },
      { manifestPath: 'apps/web-bff/package.json', tag: 'web-bff', kind: 'npm_package' },
    ]);

    // Hits the gateway READ proxy with both path params escaped.
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain(
      `/api/projects/${PROJECT_ID}/target-architectures/${ARCH_ID}/manifest-artifacts`
    );
  });

  it('coerces missing/odd fields to empty strings (no throw on a sparse row)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      okJson([{ tag: 'svc-x' }, { manifest_path: 'pom.xml' }, {}])
    );

    const rows = await fetchLatestTargetManifests(PROJECT_ID, ARCH_ID);

    expect(rows).toEqual([
      { manifestPath: '', tag: 'svc-x', kind: '' },
      { manifestPath: 'pom.xml', tag: '', kind: '' },
      { manifestPath: '', tag: '', kind: '' },
    ]);
  });

  it('FAIL-SOFT: resolves to [] on a non-2xx response (never throws)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ error: 'Architecture model service unavailable' }),
    });

    await expect(
      fetchLatestTargetManifests(PROJECT_ID, ARCH_ID)
    ).resolves.toEqual([]);
  });

  it('FAIL-SOFT: resolves to [] on a non-array body', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      okJson({ not: 'an array' })
    );

    await expect(
      fetchLatestTargetManifests(PROJECT_ID, ARCH_ID)
    ).resolves.toEqual([]);
  });

  it('FAIL-SOFT: resolves to [] on a network throw', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network down')
    );

    await expect(
      fetchLatestTargetManifests(PROJECT_ID, ARCH_ID)
    ).resolves.toEqual([]);
  });
});

describe('targetManifestApi — formatLatestTargetManifestLabel', () => {
  const row = (over: Partial<LatestTargetManifest> = {}): LatestTargetManifest => ({
    manifestPath: 'services/orders/pom.xml',
    tag: 'orders-service',
    kind: 'maven_pom',
    ...over,
  });

  it('formats "<filename> (<tag>)" using the path basename', () => {
    expect(formatLatestTargetManifestLabel(row())).toBe('pom.xml (orders-service)');
  });

  it('normalises a backslash (Windows) path to its basename', () => {
    expect(
      formatLatestTargetManifestLabel(
        row({ manifestPath: 'apps\\web-bff\\package.json', tag: 'web-bff' })
      )
    ).toBe('package.json (web-bff)');
  });

  it('derives the filename from kind when the path is empty (maven_pom -> pom.xml)', () => {
    expect(
      formatLatestTargetManifestLabel(row({ manifestPath: '', kind: 'maven_pom' }))
    ).toBe('pom.xml (orders-service)');
  });

  it('derives the filename from kind when the path is empty (npm_package -> package.json)', () => {
    expect(
      formatLatestTargetManifestLabel(
        row({ manifestPath: '', kind: 'npm_package', tag: 'web-bff' })
      )
    ).toBe('package.json (web-bff)');
  });

  it('degrades to just the filename when the tag is empty', () => {
    expect(
      formatLatestTargetManifestLabel(row({ tag: '   ' }))
    ).toBe('pom.xml');
  });

  it('degrades to "(<tag>)" when neither a path basename nor a known kind yields a filename', () => {
    expect(
      formatLatestTargetManifestLabel(
        row({ manifestPath: '', kind: 'gradle', tag: 'legacy' })
      )
    ).toBe('(legacy)');
  });

  it('degrades to "" when there is neither a usable filename nor a tag', () => {
    expect(
      formatLatestTargetManifestLabel({ manifestPath: '', kind: '', tag: '' })
    ).toBe('');
  });
});

// ============================================================================
// ResolvedTargetVersion provenance wire contract (Spec 2026-06-26 Task Group 8)
//   The provenance union additively gains 'inferred' + 'llm'; an OPTIONAL
//   sourceDependency rides alongside the manifest sourceFile. Kept lock-step with
//   the gateway shape (gateway/src/services/targetManifest/manifestPrecedence.ts);
//   each typed literal below would fail to compile under the OLD 2-value union.
// ============================================================================

describe('targetManifestApi - ResolvedTargetVersion provenance wire contract (TG8)', () => {
  it('the provenance union additively includes inferred + llm (alongside manifest/manual)', () => {
    const rows: ResolvedTargetVersion[] = [
      {
        decisionCode: 'service.framework',
        framework: 'Spring Boot',
        version: '3.4.1',
        versionUnknown: false,
        provenance: 'manifest',
        sourceFile: 'services/orders/pom.xml',
        sourceDependency: 'org.springframework.boot:spring-boot-starter-web',
      },
      {
        decisionCode: 'db.engine',
        framework: 'PostgreSQL',
        version: 'version-unknown',
        versionUnknown: true,
        provenance: 'inferred',
        sourceFile: 'services/orders/pom.xml',
        sourceDependency: 'org.postgresql:postgresql',
      },
      {
        decisionCode: 'validation.framework',
        framework: 'Hibernate Validator',
        version: '8.0.1',
        versionUnknown: false,
        provenance: 'llm',
        sourceFile: 'services/orders/pom.xml',
        sourceDependency: 'org.hibernate.validator:hibernate-validator',
      },
      {
        decisionCode: 'db.driver',
        framework: 'pgjdbc',
        version: '42.7.4',
        versionUnknown: false,
        provenance: 'manual',
        sourceFile: null,
      },
    ];
    expect(rows.map((r) => r.provenance)).toEqual([
      'manifest',
      'inferred',
      'llm',
      'manual',
    ]);
  });

  it('sourceDependency round-trips through the wire and is absent-tolerant for legacy rows', () => {
    const inferred: ResolvedTargetVersion = {
      decisionCode: 'db.engine',
      framework: 'PostgreSQL',
      version: 'version-unknown',
      versionUnknown: true,
      provenance: 'inferred',
      sourceFile: 'pom.xml',
      sourceDependency: 'org.postgresql:postgresql',
    };
    const roundTrippedInferred = JSON.parse(
      JSON.stringify(inferred),
    ) as ResolvedTargetVersion;
    expect(roundTrippedInferred.sourceDependency).toBe('org.postgresql:postgresql');

    // A legacy gateway response (no sourceDependency) decodes without inventing it.
    const legacy: ResolvedTargetVersion = {
      decisionCode: 'build.tool',
      framework: 'Maven',
      version: '3.9',
      versionUnknown: false,
      provenance: 'manifest',
      sourceFile: 'pom.xml',
    };
    const roundTrippedLegacy = JSON.parse(
      JSON.stringify(legacy),
    ) as ResolvedTargetVersion;
    expect(roundTrippedLegacy.sourceDependency).toBeUndefined();
    expect('sourceDependency' in roundTrippedLegacy).toBe(false);
  });

  it('the chip helper renders inferred / llm rows exactly like manifest/manual rows', () => {
    expect(
      resolvedTargetVersionChip({
        decisionCode: 'db.engine',
        framework: 'PostgreSQL',
        version: 'version-unknown',
        versionUnknown: true,
        provenance: 'inferred',
        sourceFile: 'pom.xml',
        sourceDependency: 'org.postgresql:postgresql',
      }),
    ).toBe('PostgreSQL (version unknown)');
    expect(
      resolvedTargetVersionChip({
        decisionCode: 'validation.framework',
        framework: 'Hibernate Validator',
        version: '8.0.1',
        versionUnknown: false,
        provenance: 'llm',
        sourceFile: 'pom.xml',
      }),
    ).toBe('Hibernate Validator 8.0.1');
  });
});
