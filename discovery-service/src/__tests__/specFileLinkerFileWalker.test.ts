/**
 * Tests for the `specFileLinker/fileWalker.ts` module.
 *
 * Spec: 2026-05-17 Spec File Auto-Linking Phase 3, Task Group 3 (sub-task 3.3).
 *
 * Coverage:
 *  1. Walks YAML/YML/JSON files under `src/main/resources/` (recursive)
 *     AND top-level files at the project root.
 *  2. Service-root scoping per P-17 filters out files outside the prefix.
 *  3. Non-spec extensions (e.g., `.properties`, `.txt`) are ignored.
 *  4. Missing `src/main/resources/` directory does not throw -- the
 *     walker returns the project-root scope's matches cleanly.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findSpecFileCandidates } from '../services/findings/packFindingScanners/specFileLinker/fileWalker';

function makeRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec-link-walker-'));
}

function writeFile(repo: string, rel: string, content: string): void {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function cleanup(repo: string): void {
  try {
    fs.rmSync(repo, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

describe('specFileLinker/fileWalker', () => {
  // =========================================================================
  // Test 1: walks YAML / YML / JSON under src/main/resources/ AND
  //         project-root top-level files.
  // =========================================================================
  it('Test 1: walks YAML/YML/JSON under src/main/resources/ (recursive) and the project root (top-level)', () => {
    const repo = makeRepo();
    try {
      writeFile(repo, 'src/main/resources/openapi.yaml', 'openapi: 3.0.3\n');
      writeFile(
        repo,
        'src/main/resources/specs/api.yml',
        'openapi: 3.0.3\n',
      );
      writeFile(
        repo,
        'src/main/resources/extra/swagger.json',
        '{"swagger":"2.0"}',
      );
      writeFile(repo, 'top-level-spec.yaml', 'openapi: 3.0.3\n');
      // Non-recursive root: a deeply-nested project file should NOT be picked
      // up by the project-root scope (only by the resources scope if it lives
      // under that prefix). Drop one elsewhere to assert.
      writeFile(repo, 'docs/nested.yaml', 'openapi: 3.0.3\n');

      const out = findSpecFileCandidates(repo, null);
      const paths = out.map((c) => c.path).sort();

      // The three under src/main/resources/ are picked up by the recursive walk.
      expect(paths).toContain('src/main/resources/openapi.yaml');
      expect(paths).toContain('src/main/resources/specs/api.yml');
      expect(paths).toContain('src/main/resources/extra/swagger.json');
      // The top-level project-root file is picked up by scope 3.
      expect(paths).toContain('top-level-spec.yaml');
      // `docs/nested.yaml` is NOT under src/main/resources/ and is NOT a
      // top-level project-root file -- it must NOT be picked up.
      expect(paths).not.toContain('docs/nested.yaml');
    } finally {
      cleanup(repo);
    }
  });

  // =========================================================================
  // Test 2: service-root scoping per P-17 filters out cross-service files.
  // =========================================================================
  it('Test 2: service-root scoping filters out files outside the prefix (P-17)', () => {
    const repo = makeRepo();
    try {
      writeFile(
        repo,
        'services/billing/src/main/resources/openapi.yaml',
        'openapi: 3.0.3\n',
      );
      writeFile(
        repo,
        'services/inventory/src/main/resources/openapi.yaml',
        'openapi: 3.0.3\n',
      );

      // Note: with a service-root prefix, src/main/resources/ at repo root is
      // empty -- the walker only finds candidates under the prefix. Run with
      // serviceRootPath='services/billing' and expect only the billing spec
      // to come back. The walker uses the repo-relative prefix test, so the
      // recursive walk under repo-root/src/main/resources/ returns nothing
      // (no such dir under repo root), and the project-root scope likewise
      // sees only files at repo root (none here).
      //
      // For this assertion to be meaningful we also place a spec at the
      // service root itself.
      writeFile(
        repo,
        'services/billing/openapi.yaml',
        'openapi: 3.0.3\n',
      );

      // Since the walker's three scopes are repo-relative
      // (src/main/resources/, repo root), the service-root prefix is
      // applied as a FILTER over the walker's output. With no spec files
      // matching the three scopes here, the result is empty -- which still
      // proves the filter works: files under services/inventory are NOT
      // returned. To exercise the in-scope path we also place a file under
      // the repo's src/main/resources but tagged with the service prefix.
      writeFile(
        repo,
        'src/main/resources/api.yaml',
        'openapi: 3.0.3\n',
      );

      const outIn = findSpecFileCandidates(repo, 'src/main/resources');
      const inPaths = outIn.map((c) => c.path);
      expect(inPaths).toContain('src/main/resources/api.yaml');

      const outOut = findSpecFileCandidates(repo, 'services/billing');
      const outPaths = outOut.map((c) => c.path);
      // Walker only walks src/main/resources/ + project-root top-level;
      // nothing under services/billing is in those scopes, so output is
      // empty. The crucial assertion: inventory's spec MUST NOT appear
      // under the billing prefix.
      expect(outPaths).not.toContain(
        'services/inventory/src/main/resources/openapi.yaml',
      );
      // And src/main/resources/api.yaml is NOT under services/billing,
      // so even though scope 1 picks it up the prefix filter excludes it.
      expect(outPaths).not.toContain('src/main/resources/api.yaml');
    } finally {
      cleanup(repo);
    }
  });

  // =========================================================================
  // Test 3: non-spec extensions are ignored.
  // =========================================================================
  it('Test 3: non-spec extensions (.properties, .txt, etc.) are ignored', () => {
    const repo = makeRepo();
    try {
      writeFile(
        repo,
        'src/main/resources/application.properties',
        'foo=bar\n',
      );
      writeFile(repo, 'src/main/resources/notes.txt', 'random notes');
      writeFile(repo, 'src/main/resources/openapi.yaml', 'openapi: 3.0.3\n');
      writeFile(repo, 'README.md', '# project');

      const out = findSpecFileCandidates(repo, null);
      const paths = out.map((c) => c.path);
      expect(paths).toEqual(['src/main/resources/openapi.yaml']);
    } finally {
      cleanup(repo);
    }
  });

  // =========================================================================
  // Test 4: missing src/main/resources/ does not throw.
  // =========================================================================
  it('Test 4: missing `src/main/resources/` directory does not throw -- project-root scope still runs', () => {
    const repo = makeRepo();
    try {
      writeFile(repo, 'openapi.yaml', 'openapi: 3.0.3\n');
      // intentionally no src/main/resources/ directory created.

      const out = findSpecFileCandidates(repo, null);
      const paths = out.map((c) => c.path);
      expect(paths).toEqual(['openapi.yaml']);
    } finally {
      cleanup(repo);
    }
  });
});
