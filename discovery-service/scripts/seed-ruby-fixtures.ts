/**
 * One-shot scaffolder for the Task Group 5 Ruby-stack fixtures.
 *
 * Spec: V3 Pack Migration Batch (Task Group 5, task 5.7)
 *
 * Authors the 10 tiered Ruby-stack fixtures in one pass by copying real
 * upstream files from the pre-cloned Discourse reference repo at
 * `C:/tmp/pack-validation/repos/discourse` into
 * `discovery-service/evaluation/fixtures/rails/<caseId>/` and
 * pre-populating `<caseId>.expected.json` with the deterministic
 * pack-pair output (all candidates tagged `'pack'`).
 *
 * Fixture selection rationale:
 *   - Mix of canonical Rails patterns exercising every rails adapter
 *     output path:
 *       * ActiveRecord models with `has_many` / `has_one` / `belongs_to`
 *         / `has_and_belongs_to_many` associations (physical_entity +
 *         entity_relationship).
 *       * ApplicationController subclasses with conventional REST action
 *         methods (interface + endpoint).
 *       * ActiveModel::Serializer subclasses with `attributes` /
 *         `has_many` macros (logical_entity + logical_data_attribute).
 *   - 10 fixtures chosen to keep each under the tree-sitter parser's
 *     effective size limit (files > ~1000 lines start failing parse with
 *     "Invalid argument" — not a correctness issue for the fixture harness,
 *     which is single-file by design, but we avoid known-failing files in
 *     seed output).
 *   - Upstream parent classes (ApplicationController / ApplicationRecord
 *     / ApplicationSerializer) are not themselves in every fixture
 *     because fixtures are single-file. The adapter correctly walks via
 *     `inheritsFromPattern` which falls back to the static regex match
 *     against the direct `extends` when the class index lacks the
 *     parent — so direct subclasses of framework bases still get picked
 *     up.
 *
 * Equivalent to running `annotate-fixture.ts` once per fixture but keeps
 * the Task Group 5 fixture author-pass reproducible from a single
 * commit-able script.
 *
 * Usage:
 *   npx tsx scripts/seed-ruby-fixtures.ts
 */

import * as fs from 'fs';
import * as path from 'path';

import { annotateFixture } from './annotate-fixture';

const FIXTURES_ROOT = path.resolve(__dirname, '..', 'evaluation', 'fixtures');

// Upstream reference repo (cloned under C:/tmp/pack-validation/repos/ by
// `scripts/batch-validate-packs.sh`). Commit SHA captured at fixture
// authoring time so baselines stay reproducible.
const DISCOURSE_ROOT = 'C:/tmp/pack-validation/repos/discourse';
const DISCOURSE_REPO = 'https://github.com/discourse/discourse';
const DISCOURSE_COMMIT = '866ae39d4642f667eb75a663e672d0eaf32db595';
const DISCOURSE_LICENSE = 'GPL-2.0-only';

type FixtureSpec = {
  caseId: string;
  sourcePath: string;
};

/**
 * 10 fixtures exercising the rails adapter's full detection surface:
 *   - Models (6): physical_entity + entity_relationship emissions across
 *     a mix of association cardinalities.
 *   - Controllers (3): interface + endpoint across small and medium
 *     controller classes.
 *   - Serializer (1): logical_entity + logical_data_attribute via
 *     ActiveModel::Serializer direct subclass.
 */
const RAILS_FIXTURES: FixtureSpec[] = [
  // tag.rb — Tag model with 13 relationships (tags, categories, topics).
  {
    caseId: 'tag-model',
    sourcePath: path.join(DISCOURSE_ROOT, 'app/models/tag.rb'),
  },
  // upload.rb — Upload model with 11 relationships (11 attachments /
  // join-model relationships).
  {
    caseId: 'upload-model',
    sourcePath: path.join(DISCOURSE_ROOT, 'app/models/upload.rb'),
  },
  // reviewable.rb — Reviewable model, 8 relationships.
  {
    caseId: 'reviewable-model',
    sourcePath: path.join(DISCOURSE_ROOT, 'app/models/reviewable.rb'),
  },
  // invite.rb — Invite model, 7 relationships.
  {
    caseId: 'invite-model',
    sourcePath: path.join(DISCOURSE_ROOT, 'app/models/invite.rb'),
  },
  // badge.rb — Badge model, 5 relationships.
  {
    caseId: 'badge-model',
    sourcePath: path.join(DISCOURSE_ROOT, 'app/models/badge.rb'),
  },
  // bookmark.rb — Bookmark model, 3 relationships (user, topic, post
  // bookmarkable polymorphism).
  {
    caseId: 'bookmark-model',
    sourcePath: path.join(DISCOURSE_ROOT, 'app/models/bookmark.rb'),
  },
  // categories_controller.rb — interface + 5 REST endpoints (larger
  // Rails controller exercising the conventional action-method path).
  {
    caseId: 'categories-controller',
    sourcePath: path.join(DISCOURSE_ROOT, 'app/controllers/categories_controller.rb'),
  },
  // bookmarks_controller.rb — interface + 3 REST endpoints.
  {
    caseId: 'bookmarks-controller',
    sourcePath: path.join(DISCOURSE_ROOT, 'app/controllers/bookmarks_controller.rb'),
  },
  // about_controller.rb — small canonical controller (interface + 1
  // endpoint — the `index` action). Exercises the minimal controller
  // shape.
  {
    caseId: 'about-controller',
    sourcePath: path.join(DISCOURSE_ROOT, 'app/controllers/about_controller.rb'),
  },
  // flagged_topic_serializer.rb — ActiveModel::Serializer direct
  // subclass with 9 attributes. The rare serializer direct-inheritance
  // case the adapter specifically targets.
  {
    caseId: 'flagged-topic-serializer',
    sourcePath: path.join(DISCOURSE_ROOT, 'app/serializers/flagged_topic_serializer.rb'),
  },
];

async function main() {
  let wrote = 0;
  let failed = 0;
  for (const spec of RAILS_FIXTURES) {
    if (!fs.existsSync(spec.sourcePath)) {
      console.error(
        `[seed-ruby-fixtures] Source file not found (is the repo cloned under C:/tmp/pack-validation/repos/discourse?): ${spec.sourcePath}`,
      );
      failed++;
      continue;
    }
    try {
      const result = await annotateFixture({
        framework: 'rails',
        caseId: spec.caseId,
        sourcePath: spec.sourcePath,
        sourceRepo: DISCOURSE_REPO,
        sourceCommit: DISCOURSE_COMMIT,
        license: DISCOURSE_LICENSE,
        fixturesRoot: FIXTURES_ROOT,
        force: true,
      });
      console.log(
        `[seed-ruby-fixtures] rails/${spec.caseId}: wrote ${result.candidateCount} candidates → ${result.fixtureDir}`,
      );
      wrote++;
    } catch (err) {
      console.error(
        `[seed-ruby-fixtures] FAILED rails/${spec.caseId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }
  console.log('');
  console.log(
    `[seed-ruby-fixtures] Done. wrote=${wrote}  failed=${failed}  total=${RAILS_FIXTURES.length}`,
  );
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
