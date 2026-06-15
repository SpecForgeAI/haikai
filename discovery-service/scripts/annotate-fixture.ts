/**
 * Fixture-scaffolding CLI for the V3 Evaluation Harness.
 *
 * Spec: `agent-os/specs/2026-04-19-v3-evaluation-harness` (Task Group 5).
 *
 * Purpose: help a human author a new fixture by running the V3 pipeline on
 * one source file and producing a pre-filled `expected.json` with every
 * produced candidate pre-tagged as `'pack'`, plus a stub `README.md`
 * carrying upstream source-metadata placeholders. The human then edits the
 * output to:
 *   - Retag items that should come from the LLM gap-fill stage (`'gap-fill'`)
 *     or may come from either stage (`'either'`).
 *   - Add missing expected items the pack happened to miss.
 *   - Populate `shouldNotEmit` entries for negative examples.
 *   - Replace the README's `TODO` placeholders with real rationale text.
 *
 * Per spec Q14: this tool deliberately does NOT attempt to auto-detect tier
 * tags. Pre-tagging everything as `'pack'` keeps the human review step safe
 * and explicit — if you want a candidate tagged `'gap-fill'`, you type it.
 *
 * CLI shape:
 *
 *   npx tsx scripts/annotate-fixture.ts \
 *     --framework <id> \
 *     --case <case-id> \
 *     --source <path-to-source-file> \
 *     --source-repo <repo-url> \
 *     --source-commit <sha> \
 *     --license <spdx-id> \
 *     [--force] \
 *     [--fixtures-root <path>]
 *
 * Framework id resolution:
 *   - `spring-classic` — runs `javaLangPack.extract` + `springClassicFrameworkPack.adapt`
 *                        directly on a one-file source map to produce pack candidates.
 *                        Deterministic, no LLM, no archModelClient.
 *   - `java-spring-boot` — runs `javaLangPack.extract` + `springBootFrameworkPack.adapt`.
 *                          Added in V3 Pack Migration Batch (Task Group 2).
 *   - `react-typescript` / `nestjs` / `angular` — run `typescriptLangPack.extract`
 *                          + the matching `<fw>FrameworkPack.adapt`. Added in
 *                          V3 Pack Migration Batch (Task Group 3).
 *   - `django` / `flask` — run `pythonLangPack.extract` + the matching
 *                          `<fw>FrameworkPack.adapt`. Added in V3 Pack
 *                          Migration Batch (Task Group 4).
 *   - `rails` — runs `rubyLangPack.extract` + `railsFrameworkPack.adapt`.
 *                          Added in V3 Pack Migration Batch (Task Group 5).
 *   - `wordpress` / `symfony` / `magento` — run `phpLangPack.extract` +
 *                          the matching `<fw>FrameworkPack.adapt`. Added in
 *                          V3 Pack Migration Batch (Task Group 6).
 *   - `kratos` — runs `goLangPack.extract` + `kratosFrameworkPack.adapt`.
 *                          Added in V3 Pack Migration Batch (Task Group 7).
 *   - `asp-net-core` / `asp-net-framework` — run `csharpLangPack.extract` +
 *                          the matching `<fw>FrameworkPack.adapt`. Added in
 *                          V3 Pack Migration Batch (Task Group 8).
 *   - `react-javascript` / `jquery` — run `javascriptLangPack.extract` +
 *                          the matching `<fw>FrameworkPack.adapt`. Added in
 *                          V3 Pack Migration Batch (Task Group 9).
 *                          `javascriptLangPack` is SEPARATE from
 *                          `typescriptLangPack` because the V2 extractors
 *                          differ.
 *   - `wxwidgets` / `oatpp` — run `cppLangPack.extract` + the matching
 *                          `<fw>FrameworkPack.adapt`. Added in V3 Pack
 *                          Migration Batch (Task Group 10).
 *                          `cppLangPack.extract` populates a module-level
 *                          raw-source cache that `oatppFrameworkPack.adapt`
 *                          reads from (Oatpp's adapter requires raw source
 *                          for ENDPOINT-macro regex scanning).
 *
 * The V3 runner spec mentions invoking `runDiscoveryV3`, but pack-only direct
 * invocation is preferred here because:
 *   - `runDiscoveryV3` requires a runId, projectId, and live archModelClient
 *     (it persists candidates + updates discovery-run mode), which is
 *     unnecessary weight for a scaffolding tool.
 *   - Pack-only invocation produces exactly the deterministic output the
 *     spec asks to pre-tag as `'pack'`.
 *
 * -------------------------------------------------------------------------
 * Fixture source filename convention
 * -------------------------------------------------------------------------
 *
 * The fixtureLoader (`src/evaluation/fixtureLoader.ts`) requires the source
 * file to have the shape `<caseId>.<ext>` so it can unambiguously find the
 * source file inside `<caseId>/`. annotate-fixture therefore copies the
 * upstream file to `<caseId>.<originalExt>` rather than preserving the
 * upstream filename. For Java / Python / Ruby / PHP / Go / C# the class /
 * module name is extracted from the file's AST (not the filename), so
 * renaming preserves pack behaviour. The `README.md` records the upstream
 * path so provenance is retained.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

import { javaLangPack } from '../src/services/extensionPacks/languagePacks/javaLangPack';
import { typescriptLangPack } from '../src/services/extensionPacks/languagePacks/typescriptLangPack';
import { pythonLangPack } from '../src/services/extensionPacks/languagePacks/pythonLangPack';
import { rubyLangPack } from '../src/services/extensionPacks/languagePacks/rubyLangPack';
import { phpLangPack } from '../src/services/extensionPacks/languagePacks/phpLangPack';
import { goLangPack } from '../src/services/extensionPacks/languagePacks/goLangPack';
import { csharpLangPack } from '../src/services/extensionPacks/languagePacks/csharpLangPack';
import { javascriptLangPack } from '../src/services/extensionPacks/languagePacks/javascriptLangPack';
import { springClassicFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/springClassicFrameworkPack';
import { springBootFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/springBootFrameworkPack';
import { reactTypescriptFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/reactTypescriptFrameworkPack';
import { nestjsFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/nestjsFrameworkPack';
import { angularFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/angularFrameworkPack';
import { djangoFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/djangoFrameworkPack';
import { flaskFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/flaskFrameworkPack';
import { railsFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/railsFrameworkPack';
import { wordpressFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/wordpressFrameworkPack';
import { symfonyFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/symfonyFrameworkPack';
import { magentoFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/magentoFrameworkPack';
import { kratosFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/kratosFrameworkPack';
import { aspNetCoreFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/aspNetCoreFrameworkPack';
import { aspNetFrameworkFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/aspNetFrameworkFrameworkPack';
import { reactJavascriptFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/reactJavascriptFrameworkPack';
import { jqueryFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/jqueryFrameworkPack';
import { cppLangPack } from '../src/services/extensionPacks/languagePacks/cppLangPack';
import { wxwidgetsFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/wxwidgetsFrameworkPack';
import { oatppFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/oatppFrameworkPack';
import type { TechHints } from '../src/services/extensionPacks/packTypes';
import type { DiscoveryCandidate } from '../src/types/candidate';
import type { ExpectedCandidate, FixtureExpectations } from '../src/evaluation/types';

// ---------------------------------------------------------------------------
// Defaults + constants.
// ---------------------------------------------------------------------------

/**
 * Default fixtures root — resolved against this script's own `__dirname`
 * so `npx tsx scripts/annotate-fixture.ts` lands in the correct location
 * regardless of `process.cwd()`.
 */
export const DEFAULT_FIXTURES_ROOT = path.resolve(
  __dirname,
  '..',
  'evaluation',
  'fixtures',
);

/**
 * Supported framework ids + their techHints mapping. `v3Migrated` indicates
 * whether the deterministic pack pair is available in-tree today; `false`
 * means we'll scaffold an empty `expected.json` and warn the operator.
 */
type FrameworkInfo = {
  v3Migrated: boolean;
  techHints: TechHints;
};

export const FRAMEWORK_REGISTRY: Record<string, FrameworkInfo> = {
  'spring-classic': {
    v3Migrated: true,
    techHints: {
      '0': { language: 'Java' },
      '1': { technology: 'Spring' },
    },
  },
  'java-spring-boot': {
    v3Migrated: true,
    techHints: {
      '0': { language: 'Java' },
      '1': { technology: 'Spring Boot' },
    },
  },
  'react-typescript': {
    v3Migrated: true,
    techHints: {
      '0': { language: 'TypeScript' },
      '1': { technology: 'React' },
    },
  },
  nestjs: {
    v3Migrated: true,
    techHints: {
      '0': { language: 'TypeScript' },
      '1': { technology: 'NestJS' },
    },
  },
  angular: {
    v3Migrated: true,
    techHints: {
      '0': { language: 'TypeScript' },
      '1': { technology: 'Angular' },
    },
  },
  django: {
    v3Migrated: true,
    techHints: {
      '0': { language: 'Python' },
      '1': { technology: 'Django' },
    },
  },
  flask: {
    v3Migrated: true,
    techHints: {
      '0': { language: 'Python' },
      '1': { technology: 'Flask' },
    },
  },
  rails: {
    v3Migrated: true,
    techHints: {
      '0': { language: 'Ruby' },
      '1': { technology: 'Rails' },
    },
  },
  wordpress: {
    v3Migrated: true,
    techHints: {
      '0': { language: 'PHP' },
      '1': { technology: 'WordPress' },
    },
  },
  symfony: {
    v3Migrated: true,
    techHints: {
      '0': { language: 'PHP' },
      '1': { technology: 'Symfony' },
    },
  },
  magento: {
    v3Migrated: true,
    techHints: {
      '0': { language: 'PHP' },
      '1': { technology: 'Magento' },
    },
  },
  kratos: {
    v3Migrated: true,
    techHints: {
      '0': { language: 'Go' },
      '1': { technology: 'Kratos' },
    },
  },
  'asp-net-core': {
    v3Migrated: true,
    techHints: {
      '0': { language: 'C#' },
      '1': { technology: 'ASP.NET Core' },
    },
  },
  'asp-net-framework': {
    v3Migrated: true,
    techHints: {
      '0': { language: 'C#' },
      '1': { technology: 'ASP.NET' },
    },
  },
  'react-javascript': {
    v3Migrated: true,
    techHints: {
      '0': { language: 'JavaScript' },
      '1': { technology: 'React' },
    },
  },
  jquery: {
    v3Migrated: true,
    techHints: {
      '0': { language: 'JavaScript' },
      '1': { technology: 'jQuery' },
    },
  },
  wxwidgets: {
    v3Migrated: true,
    techHints: {
      '0': { language: 'C++' },
      '1': { technology: 'wxWidgets' },
    },
  },
  oatpp: {
    v3Migrated: true,
    techHints: {
      '0': { language: 'C++' },
      '1': { technology: 'Oatpp' },
    },
  },
};

// ---------------------------------------------------------------------------
// Public API (testable entry point).
// ---------------------------------------------------------------------------

/**
 * Input for the `annotateFixture` function. Mirrors the CLI flag surface,
 * plus a few injection points for testability:
 *   - `fixturesRoot` — defaults to `DEFAULT_FIXTURES_ROOT`; tests point at a
 *     tmp directory.
 *   - `warn` — defaults to `console.warn`; tests capture warnings.
 */
export interface AnnotateFixtureInput {
  framework: string;
  caseId: string;
  sourcePath: string;
  sourceRepo: string;
  sourceCommit: string;
  license: string;
  fixturesRoot?: string;
  force?: boolean;
  /** Override for test capture; defaults to `console.warn`. */
  warn?: (msg: string) => void;
}

export interface AnnotateFixtureResult {
  fixtureDir: string;
  candidateCount: number;
}

/**
 * Scaffold a new evaluation fixture directory.
 *
 * Steps:
 *   1. Validate inputs (framework registered; source file exists).
 *   2. Refuse to overwrite an existing fixture dir unless `force` is set.
 *   3. Copy `<sourcePath>` into `<fixturesRoot>/<framework>/<case>/`,
 *      renaming to `<caseId>.<originalExt>` so the fixtureLoader can find
 *      it unambiguously.
 *   4. If the framework is V3-migrated, run the deterministic pack pair on
 *      the single-file source map and collect candidates. Otherwise warn
 *      and skip pack invocation.
 *   5. Write `<case>.expected.json` with every candidate pre-tagged `'pack'`
 *      and an empty `shouldNotEmit`.
 *   6. Write a stub `README.md` pre-populated with source-metadata
 *      placeholders for the human to fill in.
 */
export async function annotateFixture(
  input: AnnotateFixtureInput,
): Promise<AnnotateFixtureResult> {
  const warn = input.warn ?? ((msg: string) => console.warn(msg));
  const fixturesRoot = input.fixturesRoot ?? DEFAULT_FIXTURES_ROOT;

  const fwInfo = FRAMEWORK_REGISTRY[input.framework];
  if (!fwInfo) {
    const supported = Object.keys(FRAMEWORK_REGISTRY).join(', ');
    throw new Error(
      `[annotate-fixture] Unknown framework '${input.framework}'. Supported: ${supported}.`,
    );
  }
  if (!fs.existsSync(input.sourcePath) || !fs.statSync(input.sourcePath).isFile()) {
    throw new Error(
      `[annotate-fixture] Source file not found or not a file: ${input.sourcePath}`,
    );
  }

  // --- Step 2: collision check ------------------------------------------
  const fixtureDir = path.join(fixturesRoot, input.framework, input.caseId);
  if (fs.existsSync(fixtureDir)) {
    if (!input.force) {
      throw new Error(
        `[annotate-fixture] Fixture directory already exists: ${fixtureDir}. ` +
          `Pass --force to overwrite.`,
      );
    }
    // Force mode: nuke the existing directory so leftover stale files don't
    // survive into the rewrite.
    await fsPromises.rm(fixtureDir, { recursive: true, force: true });
  }
  await fsPromises.mkdir(fixtureDir, { recursive: true });

  // --- Step 3: copy source file -----------------------------------------
  //
  // Rename the copy to `<caseId>.<originalExt>` so the fixtureLoader's
  // `<caseId>.<ext>` convention is satisfied. The upstream original filename
  // is recorded in the README for provenance.
  const originalExt = path.extname(input.sourcePath) || '.source';
  const destSourceName = `${input.caseId}${originalExt}`;
  const destSource = path.join(fixtureDir, destSourceName);
  const sourceContents = await fsPromises.readFile(input.sourcePath, 'utf-8');
  await fsPromises.writeFile(destSource, sourceContents, 'utf-8');

  // --- Step 4: produce candidates (V3-migrated frameworks only) ---------
  let packCandidates: DiscoveryCandidate[] = [];
  if (!fwInfo.v3Migrated) {
    warn(
      `[annotate-fixture] Framework '${input.framework}' is not yet V3-migrated. ` +
        `Scaffolding an empty expected.json — please hand-author the expectations. ` +
        `Re-run annotate-fixture once the ${input.framework} V3 FrameworkPack lands.`,
    );
  } else {
    packCandidates = runPackPipeline(
      input.framework,
      destSourceName,
      sourceContents,
      fwInfo.techHints,
    );
  }

  // --- Step 5: expected.json --------------------------------------------
  //
  // Pre-tag every candidate as 'pack' per spec Q14. No auto-detection of
  // gap-fill / either — the human edits afterward.
  //
  // `description` is intentionally omitted (not written as `""`) because
  // Group 1's schema validator requires non-empty strings for optional
  // fields. The human can add a description when they edit the file.
  const expected: ExpectedCandidate[] = packCandidates.map((c) => ({
    type: c.candidateType,
    name: c.name,
    tag: 'pack',
  }));
  const expectations: FixtureExpectations = {
    expected,
    shouldNotEmit: [],
  };
  const expectedJsonPath = path.join(
    fixtureDir,
    `${input.caseId}.expected.json`,
  );
  await fsPromises.writeFile(
    expectedJsonPath,
    JSON.stringify(expectations, null, 2) + '\n',
    'utf-8',
  );

  // --- Step 6: README.md stub -------------------------------------------
  const readme = buildReadmeStub({
    caseId: input.caseId,
    sourceRepo: input.sourceRepo,
    sourceCommit: input.sourceCommit,
    license: input.license,
    originalPath: input.sourcePath,
  });
  await fsPromises.writeFile(
    path.join(fixtureDir, 'README.md'),
    readme,
    'utf-8',
  );

  return {
    fixtureDir,
    candidateCount: packCandidates.length,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/**
 * Run the deterministic pack pair for a V3-migrated framework on a single
 * source file. Returns raw `DiscoveryCandidate[]`.
 *
 * Keeping this dispatch local to the script (rather than generalized) because
 * only a handful of frameworks are V3-migrated today. When additional packs
 * migrate, add their pack pair here.
 */
function runPackPipeline(
  framework: string,
  sourceFileName: string,
  sourceContents: string,
  techHints: TechHints,
): DiscoveryCandidate[] {
  const sourceFiles = new Map<string, string>();
  sourceFiles.set(sourceFileName, sourceContents);

  switch (framework) {
    case 'spring-classic': {
      const irFiles = javaLangPack.extract(sourceFiles, techHints);
      return springClassicFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'java-spring-boot': {
      // Reuses the existing javaLangPack — no new language pack needed.
      const irFiles = javaLangPack.extract(sourceFiles, techHints);
      return springBootFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'react-typescript': {
      const irFiles = typescriptLangPack.extract(sourceFiles, techHints);
      return reactTypescriptFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'nestjs': {
      const irFiles = typescriptLangPack.extract(sourceFiles, techHints);
      return nestjsFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'angular': {
      const irFiles = typescriptLangPack.extract(sourceFiles, techHints);
      return angularFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'django': {
      const irFiles = pythonLangPack.extract(sourceFiles, techHints);
      return djangoFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'flask': {
      const irFiles = pythonLangPack.extract(sourceFiles, techHints);
      return flaskFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'rails': {
      const irFiles = rubyLangPack.extract(sourceFiles, techHints);
      return railsFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'wordpress': {
      const irFiles = phpLangPack.extract(sourceFiles, techHints);
      return wordpressFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'symfony': {
      const irFiles = phpLangPack.extract(sourceFiles, techHints);
      return symfonyFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'magento': {
      const irFiles = phpLangPack.extract(sourceFiles, techHints);
      return magentoFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'kratos': {
      const irFiles = goLangPack.extract(sourceFiles, techHints);
      return kratosFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'asp-net-core': {
      const irFiles = csharpLangPack.extract(sourceFiles, techHints);
      return aspNetCoreFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'asp-net-framework': {
      const irFiles = csharpLangPack.extract(sourceFiles, techHints);
      return aspNetFrameworkFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'react-javascript': {
      const irFiles = javascriptLangPack.extract(sourceFiles, techHints);
      return reactJavascriptFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'jquery': {
      const irFiles = javascriptLangPack.extract(sourceFiles, techHints);
      return jqueryFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'wxwidgets': {
      const irFiles = cppLangPack.extract(sourceFiles, techHints);
      return wxwidgetsFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    case 'oatpp': {
      // cppLangPack.extract has already populated the raw-source side-
      // channel cache that oatppFrameworkPack.adapt reads from for
      // ENDPOINT-macro regex scanning. Same pipeline run, same process,
      // sequential invocation — see cppLangPack/rawSourceCache.ts.
      const irFiles = cppLangPack.extract(sourceFiles, techHints);
      return oatppFrameworkPack.adapt(
        irFiles,
        'annotate-fixture',
        techHints,
      );
    }
    default:
      // Shouldn't reach here — only V3-migrated frameworks are dispatched.
      throw new Error(
        `[annotate-fixture] No V3 pack dispatch for framework '${framework}'.`,
      );
  }
}

/**
 * Build the stub README content. Placeholders are explicit `TODO` markers so
 * the human reviewer can grep for them.
 */
function buildReadmeStub(opts: {
  caseId: string;
  sourceRepo: string;
  sourceCommit: string;
  license: string;
  originalPath: string;
}): string {
  return (
    `# ${opts.caseId}\n\n` +
    `- **Source**: ${opts.sourceRepo} @ ${opts.sourceCommit}\n` +
    `- **License**: ${opts.license}\n` +
    `- **Original path**: ${opts.originalPath}\n` +
    `- **Why this fixture**: TODO\n\n` +
    `## Notes\n\n` +
    `TODO: document what makes this fixture interesting ` +
    `(happy path / edge case / blind spot).\n`
  );
}

// ---------------------------------------------------------------------------
// CLI entry point.
// ---------------------------------------------------------------------------

/**
 * Tiny arg parser for `--flag value` pairs. Supports `--force` as a boolean
 * switch. Chosen over pulling in a full arg-parsing dependency because the
 * surface is small and the existing harness scripts follow the same lean
 * style (`run-pack-local.ts`, `run-spring-classic-local.ts`).
 */
export function parseArgs(argv: string[]): {
  framework?: string;
  caseId?: string;
  sourcePath?: string;
  sourceRepo?: string;
  sourceCommit?: string;
  license?: string;
  fixturesRoot?: string;
  force: boolean;
} {
  const out: {
    framework?: string;
    caseId?: string;
    sourcePath?: string;
    sourceRepo?: string;
    sourceCommit?: string;
    license?: string;
    fixturesRoot?: string;
    force: boolean;
  } = { force: false };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const takeValue = (): string => {
      const v = argv[i + 1];
      if (v === undefined) {
        throw new Error(`[annotate-fixture] Missing value for ${flag}`);
      }
      i++;
      return v;
    };
    switch (flag) {
      case '--framework':
        out.framework = takeValue();
        break;
      case '--case':
        out.caseId = takeValue();
        break;
      case '--source':
        out.sourcePath = takeValue();
        break;
      case '--source-repo':
        out.sourceRepo = takeValue();
        break;
      case '--source-commit':
        out.sourceCommit = takeValue();
        break;
      case '--license':
        out.license = takeValue();
        break;
      case '--fixtures-root':
        out.fixturesRoot = takeValue();
        break;
      case '--force':
        out.force = true;
        break;
      default:
        throw new Error(`[annotate-fixture] Unknown argument: ${flag}`);
    }
  }
  return out;
}

function printUsageAndExit(): never {
  console.error(
    'Usage:\n' +
      '  npx tsx scripts/annotate-fixture.ts \\\n' +
      '    --framework <id> \\\n' +
      '    --case <case-id> \\\n' +
      '    --source <path-to-source-file> \\\n' +
      '    --source-repo <repo-url> \\\n' +
      '    --source-commit <sha> \\\n' +
      '    --license <spdx-id> \\\n' +
      '    [--fixtures-root <path>] \\\n' +
      '    [--force]\n',
  );
  process.exit(2);
}

async function main(): Promise<void> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    printUsageAndExit();
  }

  const required: Array<keyof typeof args> = [
    'framework',
    'caseId',
    'sourcePath',
    'sourceRepo',
    'sourceCommit',
    'license',
  ];
  for (const key of required) {
    if (!args[key]) {
      console.error(`[annotate-fixture] Missing required flag for '${key}'.`);
      printUsageAndExit();
    }
  }

  try {
    const result = await annotateFixture({
      framework: args.framework!,
      caseId: args.caseId!,
      sourcePath: args.sourcePath!,
      sourceRepo: args.sourceRepo!,
      sourceCommit: args.sourceCommit!,
      license: args.license!,
      fixturesRoot: args.fixturesRoot,
      force: args.force,
    });
    console.log(
      `[annotate-fixture] Wrote ${result.candidateCount} pre-tagged 'pack' ` +
        `candidates to ${result.fixtureDir}`,
    );
    console.log(
      `[annotate-fixture] Next: hand-edit expected.json (retag gap-fill/either, ` +
        `add missing items, populate shouldNotEmit) and fill in README.md placeholders.`,
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// Only auto-run when invoked as a script (not when imported by tests).
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
