/**
 * Fixture loader for the V3 evaluation harness.
 *
 * Spec: `agent-os/specs/2026-04-19-v3-evaluation-harness` (Task Group 1.3).
 *
 * Walks `discovery-service/evaluation/fixtures/<framework>/<case>/` and
 * produces in-memory `FixtureCase` records that the runner feeds to the
 * pipeline. Preserves the original `<case>.source` filename/extension so
 * filePath-driven detectors behave realistically.
 *
 * `expected.json` is validated against the schema documented in the spec:
 *
 *   {
 *     expected:      Array<{ type, name, tag: 'pack'|'gap-fill'|'either',
 *                            description?, notes? }>,
 *     shouldNotEmit: Array<{ type, name }>
 *   }
 *
 * Schema violations throw `FixtureValidationError` with a contextual path so
 * the operator can find the offending entry quickly. This module does NOT
 * attempt to repair bad fixtures — a malformed `expected.json` is an
 * authoring error that should fail fast rather than produce misleading
 * metrics.
 */

import * as fs from 'fs';
import * as path from 'path';

import type {
  ExpectedCandidate,
  ExpectedTag,
  FixtureCase,
  FixtureExpectations,
  ShouldNotEmitEntry,
} from './types';

// ---------------------------------------------------------------------------
// Defaults + constants.
// ---------------------------------------------------------------------------

/**
 * Default fixtures root relative to the repo layout.
 *
 * Resolved against the module's own `__dirname` so both `npx tsx` script runs
 * AND Jest test runs locate the same `evaluation/fixtures/` directory without
 * depending on `process.cwd()`.
 */
export const DEFAULT_FIXTURES_ROOT = path.resolve(
  __dirname,
  '..',
  '..',
  'evaluation',
  'fixtures',
);

/**
 * Default location of the recorded LLM-response fixtures that Group 3 replays.
 */
export const DEFAULT_LLM_FIXTURES_ROOT = path.resolve(
  __dirname,
  '..',
  '..',
  'evaluation',
  'llm-fixtures',
);

const EXPECTED_JSON_SUFFIX = '.expected.json';
const LLM_FIXTURE_SUFFIX = '.llm-response.json';
const VALID_TAGS: readonly ExpectedTag[] = ['pack', 'gap-fill', 'either'];

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

/**
 * Raised when an `expected.json` file is structurally invalid.
 *
 * The error message always includes the fixture directory and a JSON Pointer
 * style location (e.g. `/expected/2/tag`) so authors can jump straight to
 * the offending field.
 */
export class FixtureValidationError extends Error {
  readonly fixtureDir: string;
  readonly pointer: string;

  constructor(fixtureDir: string, pointer: string, message: string) {
    super(`[fixture] ${fixtureDir}: ${pointer} ${message}`);
    this.name = 'FixtureValidationError';
    this.fixtureDir = fixtureDir;
    this.pointer = pointer;
  }
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Load every fixture under `<fixturesRoot>/<framework>/<case>/`.
 *
 * Skips any framework directory whose name starts with `.` (so
 * `.DS_Store`-style accidents don't explode the run). Throws if the root
 * itself doesn't exist — an accidental empty run is never what an operator
 * wants.
 */
export function loadAllFixtures(
  fixturesRoot: string = DEFAULT_FIXTURES_ROOT,
  llmFixturesRoot: string = DEFAULT_LLM_FIXTURES_ROOT,
): FixtureCase[] {
  if (!fs.existsSync(fixturesRoot)) {
    throw new Error(
      `[fixture] fixtures root does not exist: ${fixturesRoot}. ` +
        `Create the directory or pass --fixtures-root.`,
    );
  }

  const frameworkIds = fs
    .readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();

  const out: FixtureCase[] = [];
  for (const fwId of frameworkIds) {
    out.push(...loadFrameworkFixtures(fwId, fixturesRoot, llmFixturesRoot));
  }
  return out;
}

/**
 * Load every fixture for a single framework.
 *
 * Returns an empty array (not an error) when the framework directory is
 * missing — the runner decides how to treat "no fixtures for this framework"
 * so we don't couple the loader to policy.
 */
export function loadFrameworkFixtures(
  frameworkId: string,
  fixturesRoot: string = DEFAULT_FIXTURES_ROOT,
  llmFixturesRoot: string = DEFAULT_LLM_FIXTURES_ROOT,
): FixtureCase[] {
  const frameworkDir = path.join(fixturesRoot, frameworkId);
  if (!fs.existsSync(frameworkDir)) return [];

  const caseIds = fs
    .readdirSync(frameworkDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();

  return caseIds.map((caseId) =>
    loadFixtureCase(frameworkId, caseId, fixturesRoot, llmFixturesRoot),
  );
}

/**
 * Load one fixture directory into a `FixtureCase`.
 *
 * Expects the directory to contain:
 *   - exactly one `<case>.source` (any extension — preserved verbatim so
 *     filePath-driven detectors in the pipeline behave realistically)
 *   - exactly one `<case>.expected.json`
 *   - optionally `README.md` (loaded but not validated)
 *
 * Throws `FixtureValidationError` on schema violations in `expected.json`.
 * Throws a plain `Error` on missing-file / ambiguous-source issues — those
 * are not schema violations, they're authoring mistakes at the file layout
 * level.
 */
export function loadFixtureCase(
  frameworkId: string,
  caseId: string,
  fixturesRoot: string = DEFAULT_FIXTURES_ROOT,
  llmFixturesRoot: string = DEFAULT_LLM_FIXTURES_ROOT,
): FixtureCase {
  const fixtureDir = path.join(fixturesRoot, frameworkId, caseId);
  if (!fs.existsSync(fixtureDir) || !fs.statSync(fixtureDir).isDirectory()) {
    throw new Error(
      `[fixture] fixture directory not found: ${fixtureDir}`,
    );
  }

  const entries = fs
    .readdirSync(fixtureDir, { withFileTypes: true })
    .filter((e) => e.isFile());

  // Find the `<case>.source` file.
  //
  // Accept any file whose basename begins with `<caseId>.` and whose name is
  // NOT the `<case>.expected.json` OR `README.md` entries. This lets the
  // fixture author preserve the upstream file's full extension chain (e.g.
  // `UserController.java`, `schema.hbm.xml`) — the only constraint is that
  // the filename-stem up to the first dot equals the case id.
  const sourceCandidates = entries.filter((e) => {
    if (e.name === 'README.md') return false;
    if (e.name.endsWith(EXPECTED_JSON_SUFFIX)) return false;
    // Tolerate a future convention where the source is explicitly named
    // `<case>.source` (spec default) alongside any other convention the
    // author adopts. Both are acceptable provided there is exactly one.
    return e.name.startsWith(`${caseId}.`);
  });

  if (sourceCandidates.length === 0) {
    throw new Error(
      `[fixture] no source file found in ${fixtureDir}. ` +
        `Expected a file named '${caseId}.<ext>' (e.g. '${caseId}.source' or '${caseId}.java').`,
    );
  }
  if (sourceCandidates.length > 1) {
    throw new Error(
      `[fixture] multiple source-file candidates in ${fixtureDir}: ${sourceCandidates
        .map((e) => e.name)
        .join(', ')}. Exactly one '${caseId}.<ext>' file is allowed.`,
    );
  }
  const sourceFileName = sourceCandidates[0].name;
  const sourceFilePath = path.join(fixtureDir, sourceFileName);
  const sourceContents = fs.readFileSync(sourceFilePath, 'utf-8');

  // Find the `<case>.expected.json` file.
  const expectedFileName = `${caseId}${EXPECTED_JSON_SUFFIX}`;
  const expectedFilePath = path.join(fixtureDir, expectedFileName);
  if (!fs.existsSync(expectedFilePath)) {
    throw new Error(
      `[fixture] missing ${expectedFileName} in ${fixtureDir}.`,
    );
  }
  const expectations = parseExpectedJson(
    fs.readFileSync(expectedFilePath, 'utf-8'),
    fixtureDir,
  );

  // Optional README.md.
  const readmePath = path.join(fixtureDir, 'README.md');
  const readme = fs.existsSync(readmePath)
    ? fs.readFileSync(readmePath, 'utf-8')
    : undefined;

  const llmFixturePath = path.join(
    llmFixturesRoot,
    frameworkId,
    `${caseId}${LLM_FIXTURE_SUFFIX}`,
  );

  return {
    frameworkId,
    caseId,
    fixtureDir,
    sourceFilePath,
    sourceFileName,
    sourceContents,
    expectations,
    llmFixturePath,
    readme,
  };
}

/**
 * Parse + validate an `expected.json` payload.
 *
 * Exported primarily for focused tests: callers that already have the file
 * contents in memory (e.g. from a synthetic in-test write) can validate them
 * without re-reading from disk.
 */
export function parseExpectedJson(
  raw: string,
  fixtureDir: string,
): FixtureExpectations {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new FixtureValidationError(
      fixtureDir,
      '/',
      `is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return validateExpectations(parsed, fixtureDir);
}

// ---------------------------------------------------------------------------
// Internal validation helpers.
// ---------------------------------------------------------------------------

function validateExpectations(
  value: unknown,
  fixtureDir: string,
): FixtureExpectations {
  if (!isPlainObject(value)) {
    throw new FixtureValidationError(
      fixtureDir,
      '/',
      `must be a JSON object with 'expected' and 'shouldNotEmit' arrays.`,
    );
  }

  const expectedRaw = (value as Record<string, unknown>).expected;
  const shouldNotEmitRaw = (value as Record<string, unknown>).shouldNotEmit;

  if (!Array.isArray(expectedRaw)) {
    throw new FixtureValidationError(
      fixtureDir,
      '/expected',
      `is required and must be an array.`,
    );
  }
  if (!Array.isArray(shouldNotEmitRaw)) {
    throw new FixtureValidationError(
      fixtureDir,
      '/shouldNotEmit',
      `is required and must be an array (use [] for no negative examples).`,
    );
  }

  const expected: ExpectedCandidate[] = expectedRaw.map((entry, idx) =>
    validateExpectedCandidate(entry, `/expected/${idx}`, fixtureDir),
  );
  const shouldNotEmit: ShouldNotEmitEntry[] = shouldNotEmitRaw.map((entry, idx) =>
    validateShouldNotEmitEntry(entry, `/shouldNotEmit/${idx}`, fixtureDir),
  );

  return { expected, shouldNotEmit };
}

function validateExpectedCandidate(
  value: unknown,
  pointer: string,
  fixtureDir: string,
): ExpectedCandidate {
  if (!isPlainObject(value)) {
    throw new FixtureValidationError(
      fixtureDir,
      pointer,
      `must be an object with 'type', 'name', and 'tag'.`,
    );
  }
  const obj = value as Record<string, unknown>;

  const type = requireString(obj.type, `${pointer}/type`, fixtureDir);
  const name = requireString(obj.name, `${pointer}/name`, fixtureDir);
  const tag = obj.tag;
  if (typeof tag !== 'string' || !VALID_TAGS.includes(tag as ExpectedTag)) {
    throw new FixtureValidationError(
      fixtureDir,
      `${pointer}/tag`,
      `must be one of ${VALID_TAGS.map((t) => `'${t}'`).join(' | ')} (got ${JSON.stringify(tag)}).`,
    );
  }

  const out: ExpectedCandidate = { type, name, tag: tag as ExpectedTag };
  if (obj.description !== undefined) {
    out.description = requireString(
      obj.description,
      `${pointer}/description`,
      fixtureDir,
    );
  }
  if (obj.notes !== undefined) {
    out.notes = requireString(obj.notes, `${pointer}/notes`, fixtureDir);
  }
  return out;
}

function validateShouldNotEmitEntry(
  value: unknown,
  pointer: string,
  fixtureDir: string,
): ShouldNotEmitEntry {
  if (!isPlainObject(value)) {
    throw new FixtureValidationError(
      fixtureDir,
      pointer,
      `must be an object with 'type' and 'name'.`,
    );
  }
  const obj = value as Record<string, unknown>;
  return {
    type: requireString(obj.type, `${pointer}/type`, fixtureDir),
    name: requireString(obj.name, `${pointer}/name`, fixtureDir),
  };
}

function requireString(
  value: unknown,
  pointer: string,
  fixtureDir: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new FixtureValidationError(
      fixtureDir,
      pointer,
      `must be a non-empty string (got ${JSON.stringify(value)}).`,
    );
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}
