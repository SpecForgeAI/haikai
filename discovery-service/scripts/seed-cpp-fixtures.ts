/**
 * One-shot scaffolder for the Task Group 10 C++-stack fixtures.
 *
 * Spec: V3 Pack Migration Batch (Task Group 10, task 10.8)
 *
 * Authors the 3 + 3 = 6 tiered C++-stack fixtures in one pass by
 * copying real upstream files from the pre-cloned reference repos
 * into `discovery-service/evaluation/fixtures/{wxwidgets,oatpp}/<caseId>/`
 * and pre-populating `<caseId>.expected.json` with the deterministic
 * pack-pair output (all candidates tagged `'pack'`).
 *
 * Reference repos:
 *   - wxwidgets: `C:/tmp/pack-validation/repos/wxwidgets`
 *     (wxWidgets/wxWidgets, wxWindows-3.1). The reference desktop UI
 *     toolkit. Full-repo V2 baseline = 258 candidates (per the
 *     `summary.tsv` row 19 captured at fixture-authoring time).
 *     Fixtures pick three small canonical sample files:
 *       - `samples/animate/anitest.cpp` — `MyApp : wxApp` +
 *         `MyFrame : wxFrame`. Minimal happy-path frame emission.
 *       - `samples/caret/caret.cpp` — `MyApp` + `MyCanvas :
 *         wxScrolledWindow` + `MyFrame : wxFrame`. The
 *         `wxScrolledWindow` base is NOT in the adapter's screen-or-
 *         component allowlist (`wxScrolledWindow` matches neither
 *         `SCREEN_BASE_RE` nor `COMPONENT_BASE_RE`), so MyCanvas is
 *         NOT emitted — a deliberate edge case demonstrating the
 *         "scrolled window" blind spot.
 *       - `samples/calendar/calendar.cpp` — five classes:
 *         `MyApp`, `MyPanel : wxPanel`, `MyFrame : wxFrame`,
 *         `MyDateDialog : wxDialog`, `MyTimeDialog : wxDialog`.
 *         Multi-class file demonstrating the full happy-path mix
 *         (frame + panel + two dialogs from one file).
 *
 *   - oatpp: `C:/tmp/pack-validation/repos/oatpp-crud`
 *     (oatpp/example-crud, Apache-2.0). The canonical Oatpp REST CRUD
 *     demo. Full-repo V2 baseline = 8 candidates. Fixtures pick three
 *     files that exercise distinct paths through the regex-fallback
 *     adapter:
 *       - `src/controller/UserController.hpp` — the main controller
 *         with 5 endpoints. Heaviest fixture (1 interface + 5
 *         endpoints = 6 candidates).
 *       - `src/controller/StaticController.hpp` — minimal controller
 *         with one endpoint (1 interface + 1 endpoint = 2
 *         candidates).
 *       - `src/dto/UserDto.hpp` — DTO header with `DTO_INIT` /
 *         `DTO_FIELD` macros. Adapter does NOT detect DTOs (the
 *         class extends `oatpp::DTO` not `ApiController`); deliberate
 *         zero-candidate edge case demonstrating the DTO blind spot
 *         that the prompt layer (`prompts/frameworks/oatpp.md`)
 *         calls out.
 *
 * Equivalent to running `annotate-fixture.ts` once per fixture but
 * keeps the Task Group 10 fixture author-pass reproducible from a
 * single commit-able script.
 *
 * Usage:
 *   npx tsx scripts/seed-cpp-fixtures.ts
 */

import * as fs from 'fs';
import * as path from 'path';

import { annotateFixture } from './annotate-fixture';

const FIXTURES_ROOT = path.resolve(__dirname, '..', 'evaluation', 'fixtures');

// Upstream reference repos (cloned under C:/tmp/pack-validation/repos/).
// Commit SHAs captured at fixture-authoring time so baselines stay
// reproducible.
const WX_ROOT = 'C:/tmp/pack-validation/repos/wxwidgets';
const WX_REPO = 'https://github.com/wxWidgets/wxWidgets';
const WX_LICENSE = 'wxWindows-3.1';

const OATPP_ROOT = 'C:/tmp/pack-validation/repos/oatpp-crud';
const OATPP_REPO = 'https://github.com/oatpp/example-crud';
const OATPP_LICENSE = 'Apache-2.0';

type FixtureSpec = {
  framework: 'wxwidgets' | 'oatpp';
  caseId: string;
  sourcePath: string;
  sourceRepo: string;
  sourceCommit: string;
  license: string;
};

/**
 * Discover the current `HEAD` of a cloned repo. Embedding the SHA in
 * each fixture's README ties it to a reproducible upstream snapshot
 * even though the seed script picks the SHA fresh on each run.
 */
function getRepoHeadSha(repoRoot: string): string {
  const { execSync } = require('child_process') as typeof import('child_process');
  try {
    return execSync('git rev-parse HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch (err) {
    throw new Error(
      `[seed-cpp-fixtures] Failed to read HEAD of ${repoRoot}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function main() {
  if (!fs.existsSync(WX_ROOT)) {
    console.error(
      `[seed-cpp-fixtures] wxwidgets repo not found: ${WX_ROOT}. ` +
        `Clone with: git clone https://github.com/wxWidgets/wxWidgets.git ${WX_ROOT}`,
    );
    process.exit(1);
  }
  if (!fs.existsSync(OATPP_ROOT)) {
    console.error(
      `[seed-cpp-fixtures] oatpp-crud repo not found: ${OATPP_ROOT}. ` +
        `Clone with: git clone https://github.com/oatpp/example-crud.git ${OATPP_ROOT}`,
    );
    process.exit(1);
  }

  const wxCommit = getRepoHeadSha(WX_ROOT);
  const oatppCommit = getRepoHeadSha(OATPP_ROOT);

  const fixtures: FixtureSpec[] = [
    // ---- wxwidgets ----
    {
      // Minimal happy-path: MyApp + MyFrame. Single ui_screen.
      framework: 'wxwidgets',
      caseId: 'animate-anitest',
      sourcePath: path.join(WX_ROOT, 'samples/animate/anitest.cpp'),
      sourceRepo: WX_REPO,
      sourceCommit: wxCommit,
      license: WX_LICENSE,
    },
    {
      // wxScrolledWindow blind spot: MyCanvas extends wxScrolledWindow
      // (NOT in the adapter's allowlist) so it is missed; MyFrame
      // extends wxFrame so it is emitted. Demonstrates the
      // "scrolled-window-as-screen" gap.
      framework: 'wxwidgets',
      caseId: 'caret-sample',
      sourcePath: path.join(WX_ROOT, 'samples/caret/caret.cpp'),
      sourceRepo: WX_REPO,
      sourceCommit: wxCommit,
      license: WX_LICENSE,
    },
    {
      // Multi-class file: MyPanel + MyFrame + MyDateDialog +
      // MyTimeDialog. Exercises the full happy-path mix from a single
      // source file (1 ui_component + 1 ui_screen wxFrame + 2
      // ui_screen wxDialog).
      framework: 'wxwidgets',
      caseId: 'calendar-sample',
      sourcePath: path.join(WX_ROOT, 'samples/calendar/calendar.cpp'),
      sourceRepo: WX_REPO,
      sourceCommit: wxCommit,
      license: WX_LICENSE,
    },

    // ---- oatpp ----
    {
      // Heavy controller: 1 interface + 5 endpoints = 6 candidates.
      // Exercises the regex-fallback path on the heaviest
      // ApiController subclass in the demo.
      framework: 'oatpp',
      caseId: 'user-controller',
      sourcePath: path.join(OATPP_ROOT, 'src/controller/UserController.hpp'),
      sourceRepo: OATPP_REPO,
      sourceCommit: oatppCommit,
      license: OATPP_LICENSE,
    },
    {
      // Minimal controller: 1 interface + 1 endpoint = 2 candidates.
      // Exercises the regex on the smallest ApiController subclass.
      framework: 'oatpp',
      caseId: 'static-controller',
      sourcePath: path.join(OATPP_ROOT, 'src/controller/StaticController.hpp'),
      sourceRepo: OATPP_REPO,
      sourceCommit: oatppCommit,
      license: OATPP_LICENSE,
    },
    {
      // DTO blind spot: class extends oatpp::DTO (NOT ApiController),
      // so the regex misses it entirely. Body uses DTO_INIT + DTO_FIELD
      // macros that the prompt layer enumerates. Deliberate
      // zero-candidate edge case.
      framework: 'oatpp',
      caseId: 'user-dto',
      sourcePath: path.join(OATPP_ROOT, 'src/dto/UserDto.hpp'),
      sourceRepo: OATPP_REPO,
      sourceCommit: oatppCommit,
      license: OATPP_LICENSE,
    },
  ];

  let wrote = 0;
  let failed = 0;
  for (const spec of fixtures) {
    if (!fs.existsSync(spec.sourcePath)) {
      console.error(
        `[seed-cpp-fixtures] Source file not found: ${spec.sourcePath}`,
      );
      failed++;
      continue;
    }
    try {
      const result = await annotateFixture({
        framework: spec.framework,
        caseId: spec.caseId,
        sourcePath: spec.sourcePath,
        sourceRepo: spec.sourceRepo,
        sourceCommit: spec.sourceCommit,
        license: spec.license,
        fixturesRoot: FIXTURES_ROOT,
        force: true,
      });
      console.log(
        `[seed-cpp-fixtures] ${spec.framework}/${spec.caseId}: wrote ${result.candidateCount} candidates → ${result.fixtureDir}`,
      );
      wrote++;
    } catch (err) {
      console.error(
        `[seed-cpp-fixtures] FAILED ${spec.framework}/${spec.caseId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }
  console.log('');
  console.log(
    `[seed-cpp-fixtures] Done. wrote=${wrote}  failed=${failed}  total=${fixtures.length}`,
  );
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
