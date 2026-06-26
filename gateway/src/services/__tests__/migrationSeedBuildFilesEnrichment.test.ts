/**
 * Tests for the seed-build-files enrichment seam (Spec 5, Task Groups 3 + 4).
 *
 * Spec: 2026-06-24-confirmed-manifest-to-target-codebase.
 *
 * Focused on the load-bearing carriage + trigger behaviours of the assembly
 * module (the handler-threading proof lives in
 * `migrationSeedBuildFilesThreading.test.ts`):
 *   (a) the ENTIRE confirmed manifest body rides BYTE-FOR-BYTE inside the
 *       assembled enrichment (no re-serialisation / whitespace normalisation);
 *   (b) MULTIPLE manifests -> multiple per-module blocks, each at its OWN Group 2
 *       destination path;
 *   (c) the assembly carries explicit FIRST-sequencing + authoritative-lock
 *       framing;
 *   (d) a `version-unknown` marker survives VERBATIM (no invented version);
 *   (e) an UNRESOLVED destination path is surfaced (skipped[]) but the verbatim
 *       file is still carried (never silently dropped, never a guessed path);
 *   (f) NO confirmed bundle -> safe no-op (text === null);
 *   (g) the Group 4 trigger (`resolveSeedBuildFilesEnrichment`) consumes the
 *       confirmed source and degrades a source error to a safe no-op.
 */

import {
  SEED_BUILD_FILES_STORY_KIND,
  SEED_BUILD_FILES_SECTION_HEADING,
  isSeedBuildFilesStory,
  buildSeedBuildFilesEnrichment,
  confirmedArtifactsToSeedBundle,
  resolveSeedBuildFilesEnrichment,
  ConfirmedManifestBundle,
  ConfirmedManifestArtifactLike,
} from '../migrationSeedBuildFilesEnrichment';
import {
  SEED_FILE_BODY_BEGIN,
  SEED_FILE_BODY_END,
  SeedFileManifest,
} from '../seedBuildFileWriteBlock';
import { ServiceModuleMapping } from '../seedBuildFileDestination';
import { LoadedBookOfWorkItem } from '../migrationShapeSpecGenerationHandler';

// A pom.xml body with embedded backtick + triple-backtick runs and unusual
// whitespace, to prove the sentinel fence + byte-faithful carriage survive it.
const POM_BODY =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<project xmlns="http://maven.apache.org/POM/4.0.0">\n' +
  '  <!-- embedded ``` triple backticks and ` single ` should not break the block -->\n' +
  '  <modelVersion>4.0.0</modelVersion>\n' +
  '  <groupId>com.example</groupId>\n' +
  '  <artifactId>orders-service</artifactId>\n' +
  '  <dependencies>\n' +
  '    <dependency>\n' +
  '      <groupId>org.springframework.boot</groupId>\n' +
  '      <artifactId>spring-boot-starter-web</artifactId>\n' +
  '      <version>3.4.1</version>\n' +
  '    </dependency>\n' +
  '  </dependencies>\n' +
  '</project>\n';

// A package.json carrying a literal `version-unknown` marker (Spec 3's sentinel
// for an unresolved version) — it must survive verbatim, no guessing.
const PKG_BODY =
  '{\n' +
  '  "name": "web-ui",\n' +
  '  "dependencies": {\n' +
  '    "react": "18.3.1",\n' +
  '    "left-pad": "version-unknown"\n' +
  '  }\n' +
  '}\n';

function pomManifest(tag = 'orders-service'): SeedFileManifest {
  return { fileName: 'pom.xml', content: POM_BODY, serviceTag: tag };
}

function pkgManifest(tag = 'web-ui'): SeedFileManifest {
  return { fileName: 'package.json', content: PKG_BODY, serviceTag: tag };
}

const MAPPING: ServiceModuleMapping = {
  'orders-service': { moduleDir: 'services/orders-service' },
  'web-ui': { moduleDir: 'apps/web-ui' },
};

function bundle(
  manifests: SeedFileManifest[],
  mapping: ServiceModuleMapping = MAPPING,
): ConfirmedManifestBundle {
  return { manifests, mapping, layout: 'monorepo' };
}

describe('seed-build-files enrichment (Spec 5, Groups 3 + 4)', () => {
  it('(a) carries the ENTIRE manifest body BYTE-FOR-BYTE inside the assembled enrichment', () => {
    const out = buildSeedBuildFilesEnrichment(bundle([pomManifest()]));
    expect(out.text).not.toBeNull();
    const text = out.text as string;
    // Slice between the Group 1 sentinels and assert byte-equality with source.
    const begin = text.indexOf(SEED_FILE_BODY_BEGIN);
    const end = text.indexOf(SEED_FILE_BODY_END);
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(begin);
    const carved = text.slice(begin + SEED_FILE_BODY_BEGIN.length + 1, end - 1);
    expect(carved).toBe(POM_BODY);
    expect(out.carriedCount).toBe(1);
  });

  it('(b) routes MULTIPLE manifests to distinct, correct per-module destination paths', () => {
    const out = buildSeedBuildFilesEnrichment(bundle([pomManifest(), pkgManifest()]));
    const text = out.text as string;
    expect(out.carriedCount).toBe(2);
    expect(text).toContain('services/orders-service/pom.xml');
    expect(text).toContain('apps/web-ui/package.json');
    // Both verbatim bodies present.
    expect(text).toContain(POM_BODY);
    expect(text).toContain(PKG_BODY);
  });

  it('(c) carries explicit FIRST-sequencing + authoritative-lock framing', () => {
    const out = buildSeedBuildFilesEnrichment(bundle([pomManifest()]));
    const text = out.text as string;
    expect(text).toContain(SEED_BUILD_FILES_SECTION_HEADING);
    expect(text).toContain('SEQUENCED FIRST');
    expect(text).toContain('BEFORE any other story');
    // Authoritative lock language (per-file rules come from Group 1's block).
    expect(text).toContain('byte-for-byte');
    expect(text).toMatch(/do NOT regenerate, overwrite, re-pin, upgrade, downgrade/i);
  });

  it('(d) preserves a version-unknown marker VERBATIM (no invented version)', () => {
    const out = buildSeedBuildFilesEnrichment(bundle([pkgManifest()]));
    const text = out.text as string;
    expect(text).toContain('"left-pad": "version-unknown"');
    // The per-file "do NOT invent a version" clause fired.
    expect(text).toMatch(/do NOT invent, guess, infer/i);
  });

  it('(e) surfaces an UNRESOLVED destination but STILL carries the verbatim file (never dropped/guessed)', () => {
    // Mapping has no entry for the pom's tag.
    const out = buildSeedBuildFilesEnrichment(
      bundle([pomManifest('unknown-svc')], { 'web-ui': { moduleDir: 'apps/web-ui' } }),
    );
    const text = out.text as string;
    // Still carried (verbatim body present) ...
    expect(out.carriedCount).toBe(1);
    expect(text).toContain(POM_BODY);
    // ... but the unresolved path is surfaced, not guessed.
    expect(text).toContain('UNRESOLVED');
    expect(out.skipped).toEqual([
      { serviceTag: 'unknown-svc', fileName: 'pom.xml', reason: 'destination_unresolved' },
    ]);
  });

  it('(f) NO confirmed bundle -> safe no-op (text === null, nothing carried)', () => {
    expect(buildSeedBuildFilesEnrichment(null)).toEqual({
      text: null,
      carriedCount: 0,
      skipped: [],
    });
    expect(buildSeedBuildFilesEnrichment(bundle([])).text).toBeNull();
  });

  it('(g) Group 4 trigger consumes the confirmed source; a source error degrades to a safe no-op', async () => {
    // Happy path: source returns a bundle -> enrichment carried.
    const ok = await resolveSeedBuildFilesEnrichment(
      async () => bundle([pomManifest()]),
      { projectId: 'p1', bookOfWorkId: 'b1', targetArchitectureId: 't1' },
    );
    expect(ok.carriedCount).toBe(1);
    expect(ok.text).toContain(POM_BODY);

    // Source throws -> no-op (never throws out).
    const errored = await resolveSeedBuildFilesEnrichment(
      async () => {
        throw new Error('confirmed-manifest read blew up');
      },
      { projectId: 'p1', bookOfWorkId: 'b1' },
    );
    expect(errored).toEqual({ text: null, carriedCount: 0, skipped: [] });

    // No source wired (honest v1 default) -> no-op.
    const none = await resolveSeedBuildFilesEnrichment(undefined, {
      projectId: 'p1',
      bookOfWorkId: 'b1',
    });
    expect(none.text).toBeNull();
  });

  it('recognises the dedicated seed story by its kind marker OR seed_build_files tag (Spec 6 scaffold); ignores ordinary stories', () => {
    const seed = { kind: SEED_BUILD_FILES_STORY_KIND } as LoadedBookOfWorkItem;
    const seedMixedCase = { kind: ' Seed_Build_Files ' } as LoadedBookOfWorkItem;
    // Spec 6 scaffold story: kind is `operational`, the marker rides the tag.
    const scaffold = {
      kind: 'operational',
      tags: ['seed_build_files', 'stream:target_service_api_implementation', 'provenance:scaffold'],
    } as LoadedBookOfWorkItem;
    const scaffoldMixedCase = {
      kind: 'operational',
      tags: [' Seed_Build_Files '],
    } as LoadedBookOfWorkItem;
    const ordinary = { kind: 'api' } as LoadedBookOfWorkItem;
    const ordinaryWithTags = { kind: 'api', tags: ['stream:x'] } as LoadedBookOfWorkItem;
    const noKind = {} as LoadedBookOfWorkItem;
    expect(isSeedBuildFilesStory(seed)).toBe(true);
    expect(isSeedBuildFilesStory(seedMixedCase)).toBe(true);
    expect(isSeedBuildFilesStory(scaffold)).toBe(true);
    expect(isSeedBuildFilesStory(scaffoldMixedCase)).toBe(true);
    expect(isSeedBuildFilesStory(ordinary)).toBe(false);
    expect(isSeedBuildFilesStory(ordinaryWithTags)).toBe(false);
    expect(isSeedBuildFilesStory(noKind)).toBe(false);
  });

  it('adapts Spec 3 confirmed artifacts (maven_pom / npm_package) to seed manifests; drops unsupported kinds with no throw', () => {
    const artifacts: ConfirmedManifestArtifactLike[] = [
      {
        tag: 'orders-service',
        kind: 'maven_pom',
        manifestPath: 'orders/pom.xml',
        content: POM_BODY,
        resolvedDependencies: [{ versionUnknown: false }],
      },
      {
        tag: 'web-ui',
        kind: 'npm_package',
        manifestPath: 'web/package.json',
        content: PKG_BODY,
        resolvedDependencies: [{ versionUnknown: true }],
      },
      // Unsupported (e.g. Gradle) — must be dropped with a log, not carried.
      {
        tag: 'legacy',
        kind: 'gradle_build',
        manifestPath: 'legacy/build.gradle',
        content: 'plugins {}',
      },
    ];
    const b = confirmedArtifactsToSeedBundle(artifacts, MAPPING, 'monorepo');
    expect(b.manifests.map((m) => m.fileName)).toEqual(['pom.xml', 'package.json']);
    // npm artifact's version-unknown dep flowed into hasVersionUnknown.
    const pkg = b.manifests.find((m) => m.fileName === 'package.json');
    expect(pkg?.hasVersionUnknown).toBe(true);
  });
});
