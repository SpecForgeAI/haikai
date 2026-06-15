/**
 * One-shot scaffolder for the Task Group 7 Go-stack fixtures.
 *
 * Spec: V3 Pack Migration Batch (Task Group 7, task 7.7)
 *
 * Authors the 5 tiered Go-stack fixtures in one pass by copying real
 * upstream files from the pre-cloned `beer-shop-go` reference repo at
 * `C:/tmp/pack-validation/repos/beer-shop-go` into
 * `discovery-service/evaluation/fixtures/kratos/<caseId>/` and
 * pre-populating `<caseId>.expected.json` with the deterministic
 * pack-pair output (all candidates tagged `'pack'`).
 *
 * Fixture selection rationale (per spec tasks.md 7.7 — pick service
 * interfaces, repository impls, server config, DI wiring, and one
 * business logic file):
 *
 *   1. `user-grpc-interface` (service interfaces happy path) —
 *      `api/user/service/v1/user_grpc.pb.go`. Emits 3 `interface`
 *      candidates for `UserClient`, `UserServer`, `UnsafeUserServer`
 *      via the adapter's `Server/Service/Client` name-suffix heuristic.
 *      This is the canonical protobuf-generated gRPC service contract
 *      surface in a Kratos microservice.
 *
 *   2. `user-ent-schema` (repository impl via ORM schema) —
 *      `app/user/service/internal/data/ent/user.go`. 11 candidates
 *      (2 logical_entity + 9 logical_data_attribute). Beer-shop-go
 *      uses Facebook's `ent` ORM, whose schema files carry json-
 *      tagged struct fields (for the generated query / create
 *      fluent API) but NOT gorm tags. The adapter therefore picks
 *      these up as logical_entity / logical_data_attribute rather
 *      than physical_entity — a faithful representation of the
 *      adapter's gorm-only heuristic limitation.
 *
 *   3. `cart-conf-pb` (server config happy path) —
 *      `app/cart/service/internal/conf/conf.pb.go`. 54 candidates
 *      (9 logical_entity + 45 logical_data_attribute). The generated
 *      Bootstrap / Server / Data / Auth / Registry protobuf structs
 *      carry json-protobuf tags and are caught as DTOs by the json-
 *      only heuristic. This is how the adapter surfaces the
 *      configuration surface (deployment contract).
 *
 *   4. `cart-wire-gen` (DI wiring — deliberate zero-candidate edge
 *      case) — `app/cart/service/cmd/server/wire_gen.go`. 0
 *      candidates. Google Wire generates concrete injector
 *      functions that wire the biz / data / service / server layers
 *      together. The adapter sees none of this — Wire's DI graph is
 *      invisible because there are no struct tags, no
 *      Server/Service/Client interface types. The `frameworks/
 *      kratos.md` prompt layer targets exactly this miss ("Wire
 *      dependency-injection wiring").
 *
 *   5. `cart-biz-usecase` (business logic — deliberate zero-candidate
 *      edge case) — `app/cart/service/internal/biz/cart.go`. 0
 *      candidates. Contains the `CartRepo` interface (ending in
 *      `Repo`, NOT caught by the adapter's `Server/Service/Client`
 *      name-suffix heuristic) plus the `CartUseCase` struct (no
 *      tags). The prompt layer targets both misses ("Repository
 *      pattern layering" and "UseCase / Service layer
 *      orchestration").
 *
 * Equivalent to running `annotate-fixture.ts` once per fixture but
 * keeps the Task Group 7 fixture author-pass reproducible from a
 * single commit-able script.
 *
 * Usage:
 *   npx tsx scripts/seed-go-fixtures.ts
 */

import * as fs from 'fs';
import * as path from 'path';

import { annotateFixture } from './annotate-fixture';

const FIXTURES_ROOT = path.resolve(__dirname, '..', 'evaluation', 'fixtures');

// Upstream reference repo (cloned under C:/tmp/pack-validation/repos/ by
// `scripts/batch-validate-packs.sh`). Commit SHA captured at fixture
// authoring time so baselines stay reproducible.
const BEER_SHOP_ROOT = 'C:/tmp/pack-validation/repos/beer-shop-go';
const BEER_SHOP_REPO = 'https://github.com/go-kratos/beer-shop';
const BEER_SHOP_COMMIT = 'f762a4251b7c74120c74406033b370a132cc1fde';
const BEER_SHOP_LICENSE = 'MIT';

type FixtureSpec = {
  caseId: string;
  sourcePath: string;
};

const KRATOS_FIXTURES: FixtureSpec[] = [
  // 1. Service interfaces — gRPC-generated interface types.
  {
    caseId: 'user-grpc-interface',
    sourcePath: path.join(
      BEER_SHOP_ROOT,
      'api/user/service/v1/user_grpc.pb.go',
    ),
  },
  // 2. Repository impl — ent ORM schema as the persistence-layer analogue.
  {
    caseId: 'user-ent-schema',
    sourcePath: path.join(
      BEER_SHOP_ROOT,
      'app/user/service/internal/data/ent/user.go',
    ),
  },
  // 3. Server config — conf.pb.go with Bootstrap / Server / Data / Auth structs.
  {
    caseId: 'cart-conf-pb',
    sourcePath: path.join(
      BEER_SHOP_ROOT,
      'app/cart/service/internal/conf/conf.pb.go',
    ),
  },
  // 4. DI wiring — deliberate zero-candidate edge case (Wire-generated
  // injector) demonstrating the adapter misses the Wire DI graph.
  {
    caseId: 'cart-wire-gen',
    sourcePath: path.join(
      BEER_SHOP_ROOT,
      'app/cart/service/cmd/server/wire_gen.go',
    ),
  },
  // 5. Business logic — deliberate zero-candidate edge case (biz-layer
  // UseCase + Repo interface) demonstrating the adapter misses the
  // repository pattern + UseCase orchestration.
  {
    caseId: 'cart-biz-usecase',
    sourcePath: path.join(
      BEER_SHOP_ROOT,
      'app/cart/service/internal/biz/cart.go',
    ),
  },
];

async function main() {
  let wrote = 0;
  let failed = 0;
  for (const spec of KRATOS_FIXTURES) {
    if (!fs.existsSync(spec.sourcePath)) {
      console.error(
        `[seed-go-fixtures] Source file not found (is the repo cloned under C:/tmp/pack-validation/repos/beer-shop-go?): ${spec.sourcePath}`,
      );
      failed++;
      continue;
    }
    try {
      const result = await annotateFixture({
        framework: 'kratos',
        caseId: spec.caseId,
        sourcePath: spec.sourcePath,
        sourceRepo: BEER_SHOP_REPO,
        sourceCommit: BEER_SHOP_COMMIT,
        license: BEER_SHOP_LICENSE,
        fixturesRoot: FIXTURES_ROOT,
        force: true,
      });
      console.log(
        `[seed-go-fixtures] kratos/${spec.caseId}: wrote ${result.candidateCount} candidates → ${result.fixtureDir}`,
      );
      wrote++;
    } catch (err) {
      console.error(
        `[seed-go-fixtures] FAILED kratos/${spec.caseId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }
  console.log('');
  console.log(
    `[seed-go-fixtures] Done. wrote=${wrote}  failed=${failed}  total=${KRATOS_FIXTURES.length}`,
  );
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
