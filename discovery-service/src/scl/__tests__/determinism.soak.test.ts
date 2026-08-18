/**
 * SCL determinism soak test — repeated full slices of the fixture app.
 *
 * Permanent regression guard for the 2026-08-18 nondeterminism: under the
 * NATIVE node-tree-sitter binding, repeated `indexJavaProject` runs in one
 * process intermittently walked a class body as EMPTY (0 fields / 0 methods
 * while the class name survived), so the shape set diverged run-to-run —
 * reproducible within ~40 iterations. SCL now parses via web-tree-sitter
 * (WASM, `../wasmJavaParser`); this soak asserts that EVERY iteration of the
 * full slice yields byte-identical contract identity (sorted shape symbols,
 * table keys, content hashes) and zero parse errors.
 */

import * as path from 'path';
import { sliceProject, type SclSliceResult } from '../slicer';

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'legacy-app');
const ITERATIONS = 15;

/** The full deterministic identity of one slice run, in sorted order. */
function identityOf(result: SclSliceResult): {
  shapeSymbols: string[];
  tableKeys: string[];
  contentHashes: string[];
} {
  return {
    shapeSymbols: result.shapes.map((s) => s.symbol).sort(),
    tableKeys: result.tables.map((t) => `${t.symbol}=${t.key}`).sort(),
    contentHashes: [
      ...result.shapes.map((s) => `${s.symbol}=${s.contentHash}`),
      ...result.tables.map((t) => `${t.symbol}=${t.contentHash}`),
      ...result.boundaries.map((b) => `${b.symbol}=${b.contentHash}`),
    ].sort(),
  };
}

describe('SCL determinism soak (fixture legacy app)', () => {
  jest.setTimeout(120_000);

  it(`${ITERATIONS} consecutive full slices are identical with zero parse errors`, async () => {
    const first = await sliceProject(FIXTURE_ROOT);
    expect(first.parseErrors).toEqual([]);
    expect(first.shapes.length).toBeGreaterThan(0);
    expect(first.tables.length).toBeGreaterThan(0);
    const baseline = identityOf(first);

    for (let i = 2; i <= ITERATIONS; i++) {
      const run = await sliceProject(FIXTURE_ROOT);
      // Zero parse errors on EVERY iteration (retry exhaustion lands here).
      expect({ iteration: i, parseErrors: run.parseErrors }).toEqual({
        iteration: i,
        parseErrors: [],
      });
      // Identical sorted shape symbols, table keys, and content hashes.
      expect({ iteration: i, ...identityOf(run) }).toEqual({ iteration: i, ...baseline });
    }
  });
});
