/**
 * One-shot scaffolder for the Task Group 9 JavaScript-stack fixtures.
 *
 * Spec: V3 Pack Migration Batch (Task Group 9, task 9.8)
 *
 * Authors the 5 + 3 = 8 tiered JavaScript-stack fixtures in one pass
 * by copying real upstream files from the pre-cloned reference repos
 * into `discovery-service/evaluation/fixtures/{react-javascript,jquery}/<caseId>/`
 * and pre-populating `<caseId>.expected.json` with the deterministic
 * pack-pair output (all candidates tagged `'pack'`).
 *
 * Reference repos:
 *   - react-javascript: `C:/tmp/pack-validation/repos/react-redux-realworld`
 *     (gothinkster/react-redux-realworld-example-app, MIT). Plain-JS
 *     RealWorld implementation — known low-quality on the V2 pack
 *     (full-repo baseline = 9 candidates). Fixtures span the
 *     adapter's positive emission paths (function components, *Page
 *     screens, axios call sites) plus a Redux reducer as a
 *     deliberate zero-candidate edge case.
 *   - jquery: `C:/tmp/pack-validation/repos/jquery-ui` (jquery/jquery-ui,
 *     MIT). The library that the jQuery widget pattern was designed
 *     around — but defines widgets via the IIFE-wrapped `$.widget(...)`
 *     pattern that the deterministic adapter does NOT recurse into.
 *     Full-repo V2 baseline = 0. All three fixtures are zero-candidate
 *     by design — they are the canonical example of what the adapter
 *     misses, and they exist so the per-pack 98% gate evaluates
 *     V3 = V2 = 0 (trivially passing) and the prompt layer can
 *     target the pattern.
 *
 * Fixture selection rationale:
 *
 *   react-javascript (react-redux-realworld):
 *
 *     1. `app-root` (`src/components/App.js`) — class App extends
 *        React.Component, the app root. Emits 1 `ui_component`. The
 *        canonical positive happy path on this repo.
 *
 *     2. `article-index` (`src/components/Article/index.js`) — class
 *        Article extends React.Component with this.props.match.params
 *        passed as a URL identifier in an axios-style API call. Emits
 *        1 `ui_component` + 1 `endpoint` (the URL is a property
 *        access, surfaced as `GET .props.match.params.id`).
 *
 *     3. `settings` (`src/components/Settings.js`) — two co-defined
 *        class components (Settings + SettingsForm), both extending
 *        React.Component. Emits 2 `ui_component` candidates
 *        demonstrating multi-component-per-file extraction.
 *
 *     4. `home-banner` (`src/components/Home/Banner.js`) — modern
 *        arrow-function component (`const Banner = (...) => ...`).
 *        The adapter walks function_declaration nodes only, NOT
 *        arrow-function expressions assigned to const. Emits 0
 *        candidates. Deliberate zero-candidate edge case demonstrating
 *        a major adapter blind spot for modern functional React style
 *        (probably the single largest reason the V2 baseline on this
 *        repo is only 9 — most components are arrow functions).
 *
 *     5. `home-reducer` (`src/reducers/home.js`) — Redux reducer
 *        function. Default-exported switch statement, named after the
 *        state slice. Not a component, not a hook, not surfaced as
 *        business_logic by the adapter's exclusion filters. Emits 0
 *        candidates. Zero-candidate edge case demonstrating the
 *        Redux-reducer blind spot.
 *
 *   jquery (jquery-ui):
 *
 *     1. `dialog-widget` (`ui/widgets/dialog.js`) — canonical jQuery
 *        UI widget definition. Defines `$.widget("ui.dialog", { ... })`
 *        but inside an IIFE-wrapped factory pattern that the
 *        adapter's `processCalls` walker does NOT recurse into. Emits
 *        0 candidates despite being THE canonical jQuery widget.
 *        Zero-candidate baseline; the canonical example of the
 *        adapter's blind spot.
 *
 *     2. `autocomplete-widget` (`ui/widgets/autocomplete.js`) — a
 *        jQuery UI widget that internally makes AJAX requests via
 *        `$.ajax(...)` with non-literal URL options. Adapter's
 *        regex-based options parser requires literal `url:` strings;
 *        autocomplete builds the URL dynamically. Emits 0 candidates.
 *        Zero-candidate edge case for both widget detection AND
 *        non-literal-URL ajax detection.
 *
 *     3. `widget-base` (`ui/widget.js`) — the `$.widget` factory
 *        itself. Defines `$.widget = function(name, base, prototype) {
 *        ... }` — meta-level widget infrastructure. Does NOT call
 *        `$.widget(...)`, does NOT make `$.ajax` calls. Emits 0
 *        candidates because it IS the registry, not a registration.
 *        Zero-candidate baseline showing the adapter has no concept
 *        of widget-factory registration.
 *
 * All three jquery fixtures emit 0 candidates by design, which is
 * exactly what the V2 adapter does on the same repo (V2 baseline = 0
 * across the entire jquery-ui codebase). The per-pack 98% gate
 * therefore evaluates 0 ≥ 0 × 0.98 = 0 — trivially passing. The
 * fixtures exist to:
 *  (a) Pin the migration's structural correctness (V3 wires up,
 *      runs, and emits exactly what V2 emits — nothing).
 *  (b) Provide concrete examples for the prompt layer to reference.
 *  (c) Make the adapter's misses surveyable by future Spec-4 work
 *      that fixes the IIFE-recursion / non-literal-URL detection.
 *
 * Equivalent to running `annotate-fixture.ts` once per fixture but
 * keeps the Task Group 9 fixture author-pass reproducible from a
 * single commit-able script.
 *
 * Usage:
 *   npx tsx scripts/seed-js-fixtures.ts
 */

import * as fs from 'fs';
import * as path from 'path';

import { annotateFixture } from './annotate-fixture';

const FIXTURES_ROOT = path.resolve(__dirname, '..', 'evaluation', 'fixtures');

// Upstream reference repos (cloned under C:/tmp/pack-validation/repos/).
// Commit SHAs captured at fixture-authoring time so baselines stay
// reproducible.
const REACT_JS_ROOT = 'C:/tmp/pack-validation/repos/react-redux-realworld';
const REACT_JS_REPO =
  'https://github.com/gothinkster/react-redux-realworld-example-app';
const REACT_JS_LICENSE = 'MIT';

const JQUERY_ROOT = 'C:/tmp/pack-validation/repos/jquery-ui';
const JQUERY_REPO = 'https://github.com/jquery/jquery-ui';
const JQUERY_LICENSE = 'MIT';

type FixtureSpec = {
  framework: 'react-javascript' | 'jquery';
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
      `[seed-js-fixtures] Failed to read HEAD of ${repoRoot}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function main() {
  if (!fs.existsSync(REACT_JS_ROOT)) {
    console.error(
      `[seed-js-fixtures] react-redux-realworld repo not found: ${REACT_JS_ROOT}. ` +
        `Clone with: git clone https://github.com/gothinkster/react-redux-realworld-example-app.git ${REACT_JS_ROOT}`,
    );
    process.exit(1);
  }
  if (!fs.existsSync(JQUERY_ROOT)) {
    console.error(
      `[seed-js-fixtures] jquery-ui repo not found: ${JQUERY_ROOT}. ` +
        `Clone with: git clone https://github.com/jquery/jquery-ui.git ${JQUERY_ROOT}`,
    );
    process.exit(1);
  }

  const reactJsCommit = getRepoHeadSha(REACT_JS_ROOT);
  const jqueryCommit = getRepoHeadSha(JQUERY_ROOT);

  const fixtures: FixtureSpec[] = [
    // ---- react-javascript (react-redux-realworld) ----
    {
      // Class component App extends React.Component — emits ui_component.
      framework: 'react-javascript',
      caseId: 'app-root',
      sourcePath: path.join(REACT_JS_ROOT, 'src/components/App.js'),
      sourceRepo: REACT_JS_REPO,
      sourceCommit: reactJsCommit,
      license: REACT_JS_LICENSE,
    },
    {
      // Article index — class component + this.props.match.params usage —
      // emits ui_component AND endpoint via the .find / API call inside.
      framework: 'react-javascript',
      caseId: 'article-index',
      sourcePath: path.join(REACT_JS_ROOT, 'src/components/Article/index.js'),
      sourceRepo: REACT_JS_REPO,
      sourceCommit: reactJsCommit,
      license: REACT_JS_LICENSE,
    },
    {
      // Settings class component with nested SettingsForm class component.
      // Emits two ui_component candidates (Settings + SettingsForm).
      framework: 'react-javascript',
      caseId: 'settings',
      sourcePath: path.join(REACT_JS_ROOT, 'src/components/Settings.js'),
      sourceRepo: REACT_JS_REPO,
      sourceCommit: reactJsCommit,
      license: REACT_JS_LICENSE,
    },
    {
      // Arrow-function component () — the adapter's
      // function-detection walks function_declaration nodes only, so arrow
      // functions assigned to const are NOT surfaced as ui_components.
      // Emits 0 candidates. Deliberate zero-candidate edge case
      // demonstrating a major adapter blind spot for modern React style.
      framework: 'react-javascript',
      caseId: 'home-banner',
      sourcePath: path.join(REACT_JS_ROOT, 'src/components/Home/Banner.js'),
      sourceRepo: REACT_JS_REPO,
      sourceCommit: reactJsCommit,
      license: REACT_JS_LICENSE,
    },
    {
      // Reducer module: default-exported switch-statement function. Emits 0
      // candidates — reducers are CRUD-prefixed by convention, default-
      // exported, and the adapter's business_logic filter excludes
      // PascalCase + CRUD-prefix names. Zero-candidate edge case
      // demonstrating the Redux-reducer blind spot.
      framework: 'react-javascript',
      caseId: 'home-reducer',
      sourcePath: path.join(REACT_JS_ROOT, 'src/reducers/home.js'),
      sourceRepo: REACT_JS_REPO,
      sourceCommit: reactJsCommit,
      license: REACT_JS_LICENSE,
    },

    // ---- jquery (jquery-ui) ----
    {
      framework: 'jquery',
      caseId: 'dialog-widget',
      sourcePath: path.join(JQUERY_ROOT, 'ui/widgets/dialog.js'),
      sourceRepo: JQUERY_REPO,
      sourceCommit: jqueryCommit,
      license: JQUERY_LICENSE,
    },
    {
      framework: 'jquery',
      caseId: 'autocomplete-widget',
      sourcePath: path.join(JQUERY_ROOT, 'ui/widgets/autocomplete.js'),
      sourceRepo: JQUERY_REPO,
      sourceCommit: jqueryCommit,
      license: JQUERY_LICENSE,
    },
    {
      framework: 'jquery',
      caseId: 'widget-base',
      sourcePath: path.join(JQUERY_ROOT, 'ui/widget.js'),
      sourceRepo: JQUERY_REPO,
      sourceCommit: jqueryCommit,
      license: JQUERY_LICENSE,
    },
  ];

  let wrote = 0;
  let failed = 0;
  for (const spec of fixtures) {
    if (!fs.existsSync(spec.sourcePath)) {
      console.error(
        `[seed-js-fixtures] Source file not found: ${spec.sourcePath}`,
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
        `[seed-js-fixtures] ${spec.framework}/${spec.caseId}: wrote ${result.candidateCount} candidates → ${result.fixtureDir}`,
      );
      wrote++;
    } catch (err) {
      console.error(
        `[seed-js-fixtures] FAILED ${spec.framework}/${spec.caseId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }
  console.log('');
  console.log(
    `[seed-js-fixtures] Done. wrote=${wrote}  failed=${failed}  total=${fixtures.length}`,
  );
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
