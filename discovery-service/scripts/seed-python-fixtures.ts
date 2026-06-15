/**
 * One-shot scaffolder for the Task Group 4 Python-stack fixtures.
 *
 * Spec: V3 Pack Migration Batch (Task Group 4, task 4.7)
 *
 * Authors the 15 tiered Python-stack fixtures in one pass by copying
 * real upstream files from the pre-cloned reference repos at
 * `C:/tmp/pack-validation/repos/saleor` (Django, 10 fixtures) and
 * `C:/tmp/pack-validation/repos/flask-microblog` (Flask, 5 fixtures)
 * into `discovery-service/evaluation/fixtures/<framework>/<caseId>/`
 * and pre-populating `<caseId>.expected.json` with the deterministic
 * pack-pair output (all candidates tagged `'pack'`).
 *
 * Fixture selection rationale:
 *   - Mix of canonical models (account/product/app/core/giftcard/invoice/
 *     permission/schedulers) exercising physical_entity + physical_attribute
 *     + entity_relationship output paths.
 *   - Two edge-case single-file fixtures (account-events, account-signals)
 *     where the pack correctly emits zero candidates — business functions
 *     whose Django-specific helpers don't match the pack's heuristics; and
 *     a tiny signals module. These validate the "correctly emit nothing"
 *     path (negative-recall stress tests).
 *   - Flask fixtures cover the full adapter surface: models, main blueprint
 *     routes, auth blueprint routes, API routes, and a pure helper module.
 *
 * Equivalent to running `annotate-fixture.ts` once per fixture but keeps
 * the Task Group 4 fixture author-pass reproducible from a single
 * commit-able script.
 *
 * Usage:
 *   npx tsx scripts/seed-python-fixtures.ts
 */

import * as fs from 'fs';
import * as path from 'path';

import { annotateFixture } from './annotate-fixture';

const FIXTURES_ROOT = path.resolve(__dirname, '..', 'evaluation', 'fixtures');

// Upstream reference repos (cloned under C:/tmp/pack-validation/repos/ by
// `scripts/batch-validate-packs.sh`). Commit SHAs captured at fixture
// authoring time so baselines stay reproducible.
const SALEOR_ROOT = 'C:/tmp/pack-validation/repos/saleor';
const SALEOR_REPO = 'https://github.com/saleor/saleor';
const SALEOR_COMMIT = 'b40f4635e155ecfe07bd914dad53f1cd304c4c5d';
const SALEOR_LICENSE = 'BSD-3-Clause';

const FLASK_MICROBLOG_ROOT = 'C:/tmp/pack-validation/repos/flask-microblog';
const FLASK_MICROBLOG_REPO = 'https://github.com/miguelgrinberg/microblog';
const FLASK_MICROBLOG_COMMIT = 'a975ef64864354867c88e0ed3a17ba7d17dca752';
const FLASK_MICROBLOG_LICENSE = 'MIT';

type FixtureSpec = {
  framework: 'django' | 'flask';
  caseId: string;
  sourcePath: string;
  sourceRepo: string;
  sourceCommit: string;
  license: string;
};

const DJANGO_FIXTURES: FixtureSpec[] = [
  // saleor.account — User / Address / Group stack (22 pack candidates).
  {
    framework: 'django',
    caseId: 'account-models',
    sourcePath: path.join(SALEOR_ROOT, 'saleor/account/models.py'),
    sourceRepo: SALEOR_REPO,
    sourceCommit: SALEOR_COMMIT,
    license: SALEOR_LICENSE,
  },
  // saleor.product — Product / ProductVariant / ProductType catalog (23).
  {
    framework: 'django',
    caseId: 'product-models',
    sourcePath: path.join(SALEOR_ROOT, 'saleor/product/models.py'),
    sourceRepo: SALEOR_REPO,
    sourceCommit: SALEOR_COMMIT,
    license: SALEOR_LICENSE,
  },
  // saleor.app — App / AppInstallation / AppToken (25).
  {
    framework: 'django',
    caseId: 'app-models',
    sourcePath: path.join(SALEOR_ROOT, 'saleor/app/models.py'),
    sourceRepo: SALEOR_REPO,
    sourceCommit: SALEOR_COMMIT,
    license: SALEOR_LICENSE,
  },
  // saleor.core — ModelWithMetadata + 7 base/utility models (35).
  {
    framework: 'django',
    caseId: 'core-models',
    sourcePath: path.join(SALEOR_ROOT, 'saleor/core/models.py'),
    sourceRepo: SALEOR_REPO,
    sourceCommit: SALEOR_COMMIT,
    license: SALEOR_LICENSE,
  },
  // saleor.giftcard — GiftCard + GiftCardEvent (10).
  {
    framework: 'django',
    caseId: 'giftcard-models',
    sourcePath: path.join(SALEOR_ROOT, 'saleor/giftcard/models.py'),
    sourceRepo: SALEOR_REPO,
    sourceCommit: SALEOR_COMMIT,
    license: SALEOR_LICENSE,
  },
  // saleor.invoice — Invoice (8).
  {
    framework: 'django',
    caseId: 'invoice-models',
    sourcePath: path.join(SALEOR_ROOT, 'saleor/invoice/models.py'),
    sourceRepo: SALEOR_REPO,
    sourceCommit: SALEOR_COMMIT,
    license: SALEOR_LICENSE,
  },
  // saleor.permission — Permission (8).
  {
    framework: 'django',
    caseId: 'permission-models',
    sourcePath: path.join(SALEOR_ROOT, 'saleor/permission/models.py'),
    sourceRepo: SALEOR_REPO,
    sourceCommit: SALEOR_COMMIT,
    license: SALEOR_LICENSE,
  },
  // saleor.schedulers — CustomPeriodicTask (small stable schema, 2).
  {
    framework: 'django',
    caseId: 'schedulers-models',
    sourcePath: path.join(SALEOR_ROOT, 'saleor/schedulers/models.py'),
    sourceRepo: SALEOR_REPO,
    sourceCommit: SALEOR_COMMIT,
    license: SALEOR_LICENSE,
  },
  // saleor.account.signals — tiny signals module (0 — edge case, pack should
  // emit nothing against a signals wire-up file).
  {
    framework: 'django',
    caseId: 'account-signals',
    sourcePath: path.join(SALEOR_ROOT, 'saleor/account/signals.py'),
    sourceRepo: SALEOR_REPO,
    sourceCommit: SALEOR_COMMIT,
    license: SALEOR_LICENSE,
  },
  // saleor.account.events — event-emitter helper module (0 — edge case, the
  // pack's business-logic heuristic deliberately skips module files that
  // aren't under services/utils/domain naming).
  {
    framework: 'django',
    caseId: 'account-events',
    sourcePath: path.join(SALEOR_ROOT, 'saleor/account/events.py'),
    sourceRepo: SALEOR_REPO,
    sourceCommit: SALEOR_COMMIT,
    license: SALEOR_LICENSE,
  },
];

const FLASK_FIXTURES: FixtureSpec[] = [
  // SQLAlchemy models (User / Post / Message / Notification / Task) — 17.
  {
    framework: 'flask',
    caseId: 'app-models',
    sourcePath: path.join(FLASK_MICROBLOG_ROOT, 'app/models.py'),
    sourceRepo: FLASK_MICROBLOG_REPO,
    sourceCommit: FLASK_MICROBLOG_COMMIT,
    license: FLASK_MICROBLOG_LICENSE,
  },
  // Main blueprint routes — @bp.route-decorated handlers (13).
  {
    framework: 'flask',
    caseId: 'main-routes',
    sourcePath: path.join(FLASK_MICROBLOG_ROOT, 'app/main/routes.py'),
    sourceRepo: FLASK_MICROBLOG_REPO,
    sourceCommit: FLASK_MICROBLOG_COMMIT,
    license: FLASK_MICROBLOG_LICENSE,
  },
  // Auth blueprint routes (5).
  {
    framework: 'flask',
    caseId: 'auth-routes',
    sourcePath: path.join(FLASK_MICROBLOG_ROOT, 'app/auth/routes.py'),
    sourceRepo: FLASK_MICROBLOG_REPO,
    sourceCommit: FLASK_MICROBLOG_COMMIT,
    license: FLASK_MICROBLOG_LICENSE,
  },
  // API users endpoints (REST JSON, 6).
  {
    framework: 'flask',
    caseId: 'api-users',
    sourcePath: path.join(FLASK_MICROBLOG_ROOT, 'app/api/users.py'),
    sourceRepo: FLASK_MICROBLOG_REPO,
    sourceCommit: FLASK_MICROBLOG_COMMIT,
    license: FLASK_MICROBLOG_LICENSE,
  },
  // Email helper module (0 — negative example; the pack correctly emits
  // nothing against a pure helper module with no routes / models / schemas).
  {
    framework: 'flask',
    caseId: 'app-email',
    sourcePath: path.join(FLASK_MICROBLOG_ROOT, 'app/email.py'),
    sourceRepo: FLASK_MICROBLOG_REPO,
    sourceCommit: FLASK_MICROBLOG_COMMIT,
    license: FLASK_MICROBLOG_LICENSE,
  },
];

const ALL_FIXTURES: FixtureSpec[] = [...DJANGO_FIXTURES, ...FLASK_FIXTURES];

async function main() {
  let wrote = 0;
  let failed = 0;
  for (const spec of ALL_FIXTURES) {
    if (!fs.existsSync(spec.sourcePath)) {
      console.error(
        `[seed-python-fixtures] Source file not found (is the repo cloned under C:/tmp/pack-validation/repos/?): ${spec.sourcePath}`,
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
        `[seed-python-fixtures] ${spec.framework}/${spec.caseId}: wrote ${result.candidateCount} candidates → ${result.fixtureDir}`,
      );
      wrote++;
    } catch (err) {
      console.error(
        `[seed-python-fixtures] FAILED ${spec.framework}/${spec.caseId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }
  console.log('');
  console.log(
    `[seed-python-fixtures] Done. wrote=${wrote}  failed=${failed}  total=${ALL_FIXTURES.length}`,
  );
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
