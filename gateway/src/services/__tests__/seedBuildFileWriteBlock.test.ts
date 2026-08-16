/**
 * Task Group 1 tests — Verbatim "write this exact file" block builder.
 *
 * Spec: 2026-06-24-confirmed-manifest-to-target-codebase (Spec 5), task 1.1.
 *
 * Scope (2-8 focused tests) — ONLY the load-bearing behaviours:
 *   (a) the ENTIRE manifest body rides byte-for-byte between the sentinels
 *       (byte-equality vs the source string; embedded backticks survive);
 *   (b) explicit exact-write + authoritative-lock wording is present;
 *   (c) a `version-unknown` marker in the source survives VERBATIM (no invented
 *       version) and is flagged via a `[diag-gateway]` log;
 *   (d) the resolved destination path is rendered into the instruction;
 *   (e) an unsupported file kind is rejected + logged (no silent drop).
 *
 * Formatting permutations are intentionally NOT exhaustively covered.
 */

import { logger } from '../logger';
import {
  buildSeedFileWriteBlock,
  isRejectedSeedFile,
  manifestBodyHasVersionUnknown,
  SeedFileManifest,
  SEED_FILE_BODY_BEGIN,
  SEED_FILE_BODY_END,
  VERSION_UNKNOWN_MARKER,
} from '../seedBuildFileWriteBlock';

jest.mock('../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

/**
 * Recover the exact bytes the block claims are "the file content" by slicing
 * strictly between the BEGIN and END sentinel LINES. This is precisely how a
 * downstream reader would extract the file, so equality here proves the byte
 * guarantee end-to-end.
 */
function extractCarriedBody(block: string): string {
  const beginIdx = block.indexOf(SEED_FILE_BODY_BEGIN);
  const endIdx = block.indexOf(SEED_FILE_BODY_END);
  expect(beginIdx).toBeGreaterThanOrEqual(0);
  expect(endIdx).toBeGreaterThan(beginIdx);
  // Body starts after the BEGIN line + its trailing newline; ends at the newline
  // immediately before the END line.
  const afterBegin = beginIdx + SEED_FILE_BODY_BEGIN.length + 1; // +1 == the '\n'
  const beforeEnd = endIdx - 1; // drop the '\n' that precedes the END line
  return block.slice(afterBegin, beforeEnd);
}

// A package.json whose body deliberately contains backtick runs (incl. a triple
// backtick) + awkward whitespace, to prove the fence cannot be broken by content
// and that no whitespace normalisation occurs.
const PACKAGE_JSON_WITH_BACKTICKS = `{
  "name": "@acme/orders",
  "version": "1.0.0",
  "scripts": {
    "echo": "echo \`hello\` and \\\`\\\`\\\` fenced"
  },
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1"
  }
}
`; // trailing newline intentionally preserved

const POM_WITH_VERSION_UNKNOWN = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>svc</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>3.4.1</version>
    </dependency>
    <dependency>
      <groupId>com.acme</groupId>
      <artifactId>legacy-lib</artifactId>
      <!-- unresolved by Spec 3 -->
      <version>version-unknown</version>
    </dependency>
  </dependencies>
</project>
`;

function manifest(overrides: Partial<SeedFileManifest> = {}): SeedFileManifest {
  return {
    fileName: 'package.json',
    content: PACKAGE_JSON_WITH_BACKTICKS,
    serviceTag: 'orders-service',
    destinationPath: 'services/orders-service/package.json',
    ...overrides,
  };
}

describe('buildSeedFileWriteBlock — verbatim carriage core (Spec 5, Group 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('(a) carries the ENTIRE manifest body byte-for-byte, even with embedded backticks', () => {
    const result = buildSeedFileWriteBlock(manifest());
    expect(typeof result).toBe('string');
    const block = result as string;
    const carried = extractCarriedBody(block);
    // Byte-equality vs the source string — no re-serialisation, no whitespace
    // normalisation, no entity-escaping of the body.
    expect(carried).toBe(PACKAGE_JSON_WITH_BACKTICKS);
    // The triple-backtick run survived inside the block (fence cannot collide).
    expect(block).toContain('\\`\\`\\` fenced');
  });

  it('(a2) carries a pom.xml body byte-for-byte', () => {
    const block = buildSeedFileWriteBlock(
      manifest({ fileName: 'pom.xml', content: POM_WITH_VERSION_UNKNOWN }),
    ) as string;
    expect(extractCarriedBody(block)).toBe(POM_WITH_VERSION_UNKNOWN);
  });

  it('(b) includes exact-initial-write + starting-point wording (2026-08-16: additions permitted, existing entries survive)', () => {
    const block = buildSeedFileWriteBlock(manifest()) as string;
    expect(block).toContain('Create this file with EXACTLY this content');
    // 2026-08-16 ruling: the seeded file is the authoritative STARTING POINT,
    // not a freeze — the old "Do NOT change, add, or remove any declared
    // dependency" lock made the implementer refuse to add liquibase-core when
    // the db.migrations decision demanded it (live failure: nothing enabled
    // Liquibase). Existing entries still survive; additions are permitted.
    expect(block).toMatch(/AUTHORITATIVE STARTING\s*POINT/);
    expect(block).toMatch(/ADDITIONS ARE PERMITTED/);
    expect(block).toMatch(/never re-pin, upgrade,\s*downgrade, re-order, or remove/);
    expect(block).not.toMatch(/FROZEN/);
    expect(block).not.toMatch(/Do NOT change, add, or remove/);
    // build around it
    expect(block).toMatch(/Build the rest of\s*the codebase to FIT this file/);
    expect(block).toMatch(/NOT a suggestion/);
  });

  it('(c) carries a version-unknown marker VERBATIM (no invented version) + logs it', () => {
    expect(manifestBodyHasVersionUnknown(POM_WITH_VERSION_UNKNOWN)).toBe(true);
    const block = buildSeedFileWriteBlock(
      manifest({
        fileName: 'pom.xml',
        content: POM_WITH_VERSION_UNKNOWN,
        hasVersionUnknown: true,
      }),
    ) as string;
    // The marker survives verbatim inside the carried body.
    expect(extractCarriedBody(block)).toContain(`<version>${VERSION_UNKNOWN_MARKER}</version>`);
    // The instruction explicitly forbids inventing a version for it.
    expect(block).toMatch(/do NOT invent, guess, infer/i);
    // No-silent-handling: a [diag-gateway] note was logged.
    const infoCalls = (logger.info as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(
      infoCalls.some((m) => m.includes('seed_file_version_unknown_carried')),
    ).toBe(true);
  });

  it('(d) renders the resolved destination path into the instruction', () => {
    const block = buildSeedFileWriteBlock(
      manifest({ destinationPath: 'services/orders-service/package.json' }),
    ) as string;
    expect(block).toContain(
      'Destination path (write the file at EXACTLY this path): services/orders-service/package.json',
    );
    // When no path is resolved, it must NOT guess — it renders an explicit notice.
    const noPath = buildSeedFileWriteBlock(
      manifest({ destinationPath: null }),
    ) as string;
    expect(noPath).toMatch(/Destination path: UNRESOLVED/);
    expect(noPath).toMatch(/Do NOT guess a location/);
  });

  it('(e) rejects an unsupported file kind with a [diag-gateway] log (no silent drop)', () => {
    const result = buildSeedFileWriteBlock(
      manifest({ fileName: 'build.gradle' as unknown as SeedFileManifest['fileName'] }),
    );
    expect(isRejectedSeedFile(result)).toBe(true);
    if (isRejectedSeedFile(result)) {
      expect(result.reason).toMatch(/Unsupported seed build-file kind/);
    }
    const warnCalls = (logger.warn as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(warnCalls.some((m) => m.includes('seed_file_rejected'))).toBe(true);
  });
});
