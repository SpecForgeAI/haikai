/**
 * One-shot scaffolder for the Task Group 6 PHP-stack fixtures.
 *
 * Spec: V3 Pack Migration Batch (Task Group 6, task 6.9)
 *
 * Authors the 15 tiered PHP-stack fixtures in one pass by copying real
 * upstream files from the pre-cloned reference repos at
 * `C:/tmp/pack-validation/repos/{wordpress,orangehrm,magento-lts}` into
 * `discovery-service/evaluation/fixtures/{wordpress,symfony,magento}/`
 * and pre-populating `<caseId>.expected.json` with the deterministic
 * pack-pair output (all candidates tagged `'pack'`).
 *
 * Fixture selection rationale:
 *
 *   wordpress (5 fixtures, baseline 88):
 *     - 2 widgets extending `WP_Widget` → ui_component emissions.
 *     - 2 REST controllers extending `WP_REST_Controller` with
 *       `register_rest_route` call sites inside methods → interface +
 *       endpoint emissions.
 *     - 1 additional REST controller (interface only) for variety.
 *
 *   symfony (5 fixtures, baseline 243):
 *     - 5 controllers extending `AbstractController` / custom
 *       `*Controller` bases from the orangehrm admin + authentication
 *       plugins → interface emissions. orangehrm is Symfony-based but
 *       predates PHP 8 attributes (uses PHPDoc `@ORM\Entity`), so
 *       entities are invisible to the current adapter. Controllers are
 *       the only consistently emitted surface on this repo.
 *
 *   magento (5 fixtures, baseline 436):
 *     - 3 admin models extending `Mage_Core_Model_Abstract` →
 *       physical_entity emissions.
 *     - 1 admin block extending `Mage_Adminhtml_Block_*` →
 *       ui_component emission.
 *     - 1 controller extending `Mage_Core_Controller_Front_Action` →
 *       interface emission.
 *
 * Fixture selection avoids tree-sitter-php's "Invalid argument"
 * parse-failure threshold on very-large PHP files (the Catalog Product
 * / Customer / Sales-Order models all fail to parse when extracted
 * single-file, but parse fine during the full-repo `run-pack-local`
 * walk — tree-sitter-php's internal size threshold is per-invocation,
 * not per-file-bytes). Note captured in `FIXTURES-TODO.md`.
 *
 * Equivalent to running `annotate-fixture.ts` once per fixture but
 * keeps the Task Group 6 fixture author-pass reproducible from a
 * single commit-able script.
 *
 * Usage:
 *   npx tsx scripts/seed-php-fixtures.ts
 */

import * as fs from 'fs';
import * as path from 'path';

import { annotateFixture } from './annotate-fixture';

const FIXTURES_ROOT = path.resolve(__dirname, '..', 'evaluation', 'fixtures');

// --- WordPress reference repo ---------------------------------------------
// Cloned under C:/tmp/pack-validation/repos/wordpress. Commit SHA captured
// at fixture-authoring time so baselines stay reproducible.
const WP_ROOT = 'C:/tmp/pack-validation/repos/wordpress';
const WP_REPO = 'https://github.com/WordPress/wordpress-develop';
const WP_COMMIT = '4b9731d84ebfc95d791a68be22cbe84fe3e5e140';
const WP_LICENSE = 'GPL-2.0-or-later';

// --- Symfony reference repo (orangehrm is Symfony-based) ------------------
const SY_ROOT = 'C:/tmp/pack-validation/repos/orangehrm';
const SY_REPO = 'https://github.com/orangehrm/orangehrm';
const SY_COMMIT = 'd3a50a814c3098fde81b99abfaacd8cb5a787429';
const SY_LICENSE = 'GPL-3.0-only';

// --- Magento reference repo -----------------------------------------------
const MAG_ROOT = 'C:/tmp/pack-validation/repos/magento-lts';
const MAG_REPO = 'https://github.com/OpenMage/magento-lts';
const MAG_COMMIT = '53e2dd30cfde1fede26a3e77e8e64457d51e1deb';
const MAG_LICENSE = 'OSL-3.0';

type FixtureSpec = {
  framework: 'wordpress' | 'symfony' | 'magento';
  caseId: string;
  sourcePath: string;
  repo: string;
  commit: string;
  license: string;
};

const FIXTURES: FixtureSpec[] = [
  // ------------------------------ WordPress ------------------------------
  // Small widget — ui_component emission via `extends WP_Widget`.
  {
    framework: 'wordpress',
    caseId: 'widget-calendar',
    sourcePath: path.join(WP_ROOT, 'wp-includes/widgets/class-wp-widget-calendar.php'),
    repo: WP_REPO,
    commit: WP_COMMIT,
    license: WP_LICENSE,
  },
  // Nav-menu widget — ui_component emission.
  {
    framework: 'wordpress',
    caseId: 'widget-nav-menu',
    sourcePath: path.join(WP_ROOT, 'wp-includes/widgets/class-wp-nav-menu-widget.php'),
    repo: WP_REPO,
    commit: WP_COMMIT,
    license: WP_LICENSE,
  },
  // REST controller + register_rest_route call → interface + endpoint.
  {
    framework: 'wordpress',
    caseId: 'rest-abilities-categories-controller',
    sourcePath: path.join(WP_ROOT, 'wp-includes/rest-api/endpoints/class-wp-rest-abilities-v1-categories-controller.php'),
    repo: WP_REPO,
    commit: WP_COMMIT,
    license: WP_LICENSE,
  },
  // REST controller + register_rest_route → interface + endpoint.
  {
    framework: 'wordpress',
    caseId: 'rest-block-renderer-controller',
    sourcePath: path.join(WP_ROOT, 'wp-includes/rest-api/endpoints/class-wp-rest-block-renderer-controller.php'),
    repo: WP_REPO,
    commit: WP_COMMIT,
    license: WP_LICENSE,
  },
  // Small REST controller (interface only — no detectable register_rest_route
  // inside the class). Tests the interface-only emission path.
  {
    framework: 'wordpress',
    caseId: 'rest-edit-site-export-controller',
    sourcePath: path.join(WP_ROOT, 'wp-includes/rest-api/endpoints/class-wp-rest-edit-site-export-controller.php'),
    repo: WP_REPO,
    commit: WP_COMMIT,
    license: WP_LICENSE,
  },

  // ------------------------------ Symfony --------------------------------
  // Small standalone controller — interface emission.
  {
    framework: 'symfony',
    caseId: 'logout-controller',
    sourcePath: path.join(SY_ROOT, 'src/plugins/orangehrmAuthenticationPlugin/Controller/LogoutController.php'),
    repo: SY_REPO,
    commit: SY_COMMIT,
    license: SY_LICENSE,
  },
  // Medium controller with PublicControllerInterface implementation.
  {
    framework: 'symfony',
    caseId: 'administrator-verify-controller',
    sourcePath: path.join(SY_ROOT, 'src/plugins/orangehrmAuthenticationPlugin/Controller/AdministratorVerifyController.php'),
    repo: SY_REPO,
    commit: SY_COMMIT,
    license: SY_LICENSE,
  },
  // Admin plugin controller — typical orangehrm admin Vue-rendering
  // controller shape (`extends AbstractVueController`, which falls under
  // the `*Controller` name-suffix match).
  {
    framework: 'symfony',
    caseId: 'job-title-controller',
    sourcePath: path.join(SY_ROOT, 'src/plugins/orangehrmAdminPlugin/Controller/JobTitleController.php'),
    repo: SY_REPO,
    commit: SY_COMMIT,
    license: SY_LICENSE,
  },
  // Admin module controller.
  {
    framework: 'symfony',
    caseId: 'admin-module-controller',
    sourcePath: path.join(SY_ROOT, 'src/plugins/orangehrmAdminPlugin/Controller/AdminModuleController.php'),
    repo: SY_REPO,
    commit: SY_COMMIT,
    license: SY_LICENSE,
  },
  // Work-shift controller.
  {
    framework: 'symfony',
    caseId: 'work-shift-controller',
    sourcePath: path.join(SY_ROOT, 'src/plugins/orangehrmAdminPlugin/Controller/WorkShiftController.php'),
    repo: SY_REPO,
    commit: SY_COMMIT,
    license: SY_LICENSE,
  },

  // ------------------------------ Magento --------------------------------
  // Admin model — physical_entity via `extends Mage_Core_Model_Abstract`.
  {
    framework: 'magento',
    caseId: 'admin-block-model',
    sourcePath: path.join(MAG_ROOT, 'app/code/core/Mage/Admin/Model/Block.php'),
    repo: MAG_REPO,
    commit: MAG_COMMIT,
    license: MAG_LICENSE,
  },
  // Admin role model — physical_entity.
  {
    framework: 'magento',
    caseId: 'admin-role-model',
    sourcePath: path.join(MAG_ROOT, 'app/code/core/Mage/Admin/Model/Role.php'),
    repo: MAG_REPO,
    commit: MAG_COMMIT,
    license: MAG_LICENSE,
  },
  // Admin variable model — physical_entity.
  {
    framework: 'magento',
    caseId: 'admin-variable-model',
    sourcePath: path.join(MAG_ROOT, 'app/code/core/Mage/Admin/Model/Variable.php'),
    repo: MAG_REPO,
    commit: MAG_COMMIT,
    license: MAG_LICENSE,
  },
  // Adminhtml block — ui_component via `extends Mage_Adminhtml_Block_*`.
  {
    framework: 'magento',
    caseId: 'adminhtml-html-date-block',
    sourcePath: path.join(MAG_ROOT, 'app/code/core/Mage/Adminhtml/Block/Html/Date.php'),
    repo: MAG_REPO,
    commit: MAG_COMMIT,
    license: MAG_LICENSE,
  },
  // CMS front controller — interface via `extends Mage_Core_Controller_Front_Action`.
  {
    framework: 'magento',
    caseId: 'cms-index-controller',
    sourcePath: path.join(MAG_ROOT, 'app/code/core/Mage/Cms/controllers/IndexController.php'),
    repo: MAG_REPO,
    commit: MAG_COMMIT,
    license: MAG_LICENSE,
  },
];

async function main() {
  let wrote = 0;
  let failed = 0;
  for (const spec of FIXTURES) {
    if (!fs.existsSync(spec.sourcePath)) {
      console.error(
        `[seed-php-fixtures] Source file not found (is the repo cloned under C:/tmp/pack-validation/repos/?): ${spec.sourcePath}`,
      );
      failed++;
      continue;
    }
    try {
      const result = await annotateFixture({
        framework: spec.framework,
        caseId: spec.caseId,
        sourcePath: spec.sourcePath,
        sourceRepo: spec.repo,
        sourceCommit: spec.commit,
        license: spec.license,
        fixturesRoot: FIXTURES_ROOT,
        force: true,
      });
      console.log(
        `[seed-php-fixtures] ${spec.framework}/${spec.caseId}: wrote ${result.candidateCount} candidates → ${result.fixtureDir}`,
      );
      wrote++;
    } catch (err) {
      console.error(
        `[seed-php-fixtures] FAILED ${spec.framework}/${spec.caseId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }
  console.log('');
  console.log(
    `[seed-php-fixtures] Done. wrote=${wrote}  failed=${failed}  total=${FIXTURES.length}`,
  );
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
