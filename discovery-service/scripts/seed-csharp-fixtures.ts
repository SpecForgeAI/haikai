/**
 * One-shot scaffolder for the Task Group 8 C#-stack fixtures.
 *
 * Spec: V3 Pack Migration Batch (Task Group 8, tasks 8.8 + 8.9)
 *
 * Authors the 5 + 5 = 10 tiered C#-stack fixtures in one pass by
 * copying real upstream files from the pre-cloned reference repos
 * into `discovery-service/evaluation/fixtures/{asp-net-core,asp-net-framework}/<caseId>/`
 * and pre-populating `<caseId>.expected.json` with the deterministic
 * pack-pair output (all candidates tagged `'pack'`).
 *
 * Reference repos:
 *   - asp-net-core: `C:/tmp/pack-validation/repos/eshoponweb` — known
 *     low quality (V2 baseline 36 candidates on a ~120-file repo).
 *     The 5 fixtures deliberately span the full range of behaviour:
 *     POCOs without `[Table]` (Fluent API config — invisible),
 *     DbContext with many DbSets (the one consistent positive emission
 *     path), and Controller / ApiController subclasses (the other).
 *   - asp-net-framework: `C:/tmp/pack-validation/repos/nugetgallery`
 *     — REPLACEMENT for the deleted eShopLegacyMVC. NuGetGallery is
 *     a real-world large-scale .NET Framework 4.x web app
 *     (NuGet's official package gallery). Cloned at
 *     `https://github.com/NuGet/NuGetGallery.git` (Apache 2.0).
 *
 * Fixture selection rationale (5 per pack):
 *
 *   asp-net-core (eshoponweb):
 *
 *     1. `catalog-context` (DbContext positive happy path) —
 *        `src/Infrastructure/Data/CatalogContext.cs`. EF Core
 *        DbContext with 7 DbSets (Baskets / CatalogItems /
 *        CatalogBrands / CatalogTypes / Orders / OrderItems /
 *        BasketItems). Emits 7 `physical_entity` candidates.
 *
 *     2. `base-api-controller` (controller positive happy path) —
 *        `src/Web/Controllers/Api/BaseApiController.cs`. Minimal
 *        `[ApiController]` + `[Route]` annotated controller with no
 *        action methods. Emits 1 `interface` candidate. Demonstrates
 *        the controller-detection path in isolation.
 *
 *     3. `user-controller` (controller with HTTP endpoints) —
 *        `src/Web/Controllers/UserController.cs`. `[ApiController]`
 *        + `[HttpGet]` and `[HttpPost]` action methods. Emits
 *        `interface` + `endpoint` candidates.
 *
 *     4. `order-controller` (MVC Controller with [HttpGet]) —
 *        `src/Web/Controllers/OrderController.cs`. `Controller`
 *        subclass (NOT `ControllerBase`) with `[HttpGet]` + `[HttpGet
 *        ("{orderId}")]` action methods. Emits `interface` +
 *        `endpoint` candidates.
 *
 *     5. `app-identity-db-context` (DbContext zero-candidate edge
 *        case) — `src/Infrastructure/Identity/AppIdentityDbContext.cs`.
 *        Extends `IdentityDbContext<ApplicationUser>` but declares
 *        NO `DbSet<T>` properties (Identity tables are configured
 *        by the base class). Emits 0 candidates — the adapter sees
 *        the IdentityDbContext base ends in DbContext but finds no
 *        DbSets. Demonstrates the gap: the FILE represents an
 *        identity store the framework configures, but the
 *        deterministic adapter cannot see it without parsing the
 *        Identity-base setup.
 *
 *   asp-net-framework (nugetgallery):
 *
 *     1. `app-controller` (abstract MVC base) —
 *        `src/NuGetGallery/Controllers/AppController.cs`. Partial
 *        abstract class extending `Controller`. Emits 1 `interface`
 *        candidate. Demonstrates partial-class + abstract handling.
 *
 *     2. `errors-controller` (action methods without HTTP-verb
 *        attributes) — `src/NuGetGallery/Controllers/ErrorsController.cs`.
 *        `partial class ErrorsController : AppController` with action
 *        methods carrying `[AcceptVerbs(HttpVerbs.Get | HttpVerbs.Head)]`
 *        — NOT `[HttpGet]` / `[HttpPost]`. The adapter detects the
 *        controller (interface) but emits NO endpoints because
 *        `[AcceptVerbs]` is not in the verb-attribute list. Useful
 *        edge case demonstrating the .NET Framework alternative
 *        attribute syntax the adapter misses.
 *
 *     3. `pages-controller` (controller with [HttpGet] endpoints) —
 *        `src/NuGetGallery/Controllers/PagesController.cs`. `partial
 *        class PagesController : AppController` with `[HttpGet]`-
 *        annotated action methods. Emits `interface` + multiple
 *        `endpoint` candidates.
 *
 *     4. `entities-context` (EF6 DbContext with many DbSets) —
 *        `src/NuGetGallery.Core/Entities/EntitiesContext.cs`.
 *        Extends `ObjectMaterializedInterceptingDbContext` (whose
 *        name ends in `DbContext`) and declares many `DbSet<T>`
 *        properties (Packages, Credentials, Scopes, Users, etc.).
 *        Emits many `physical_entity` candidates — the largest
 *        positive emission in the .NET Framework fixture set.
 *
 *     5. `credential-entity` (POCO without [Table] — zero-candidate
 *        edge case) — `src/NuGet.Services.Entities/Credential.cs`.
 *        Plain POCO implementing `IEntity` with `[Required]` /
 *        `[StringLength]` Data Annotations on properties — but NO
 *        `[Table]` annotation on the class. The adapter only emits
 *        physical_entity for `[Table]`-annotated POCOs, so this
 *        emits 0 candidates even though the class is mapped to a
 *        DB table via Fluent API in `EntitiesContext.cs`.
 *        Demonstrates the Fluent-API-configuration blind spot.
 *
 * Equivalent to running `annotate-fixture.ts` once per fixture but
 * keeps the Task Group 8 fixture author-pass reproducible from a
 * single commit-able script.
 *
 * Usage:
 *   npx tsx scripts/seed-csharp-fixtures.ts
 */

import * as fs from 'fs';
import * as path from 'path';

import { annotateFixture } from './annotate-fixture';

const FIXTURES_ROOT = path.resolve(__dirname, '..', 'evaluation', 'fixtures');

// Upstream reference repos (cloned under C:/tmp/pack-validation/repos/).
// Commit SHAs captured at fixture-authoring time so baselines stay
// reproducible.
const ESHOPONWEB_ROOT = 'C:/tmp/pack-validation/repos/eshoponweb';
const ESHOPONWEB_REPO = 'https://github.com/dotnet-architecture/eShopOnWeb';
const ESHOPONWEB_LICENSE = 'MIT';

const NUGETGALLERY_ROOT = 'C:/tmp/pack-validation/repos/nugetgallery';
const NUGETGALLERY_REPO = 'https://github.com/NuGet/NuGetGallery';
const NUGETGALLERY_LICENSE = 'Apache-2.0';

type FixtureSpec = {
  framework: 'asp-net-core' | 'asp-net-framework';
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
      `[seed-csharp-fixtures] Failed to read HEAD of ${repoRoot}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function main() {
  if (!fs.existsSync(ESHOPONWEB_ROOT)) {
    console.error(
      `[seed-csharp-fixtures] eshoponweb repo not found: ${ESHOPONWEB_ROOT}. ` +
        `Clone with: git clone https://github.com/dotnet-architecture/eShopOnWeb.git ${ESHOPONWEB_ROOT}`,
    );
    process.exit(1);
  }
  if (!fs.existsSync(NUGETGALLERY_ROOT)) {
    console.error(
      `[seed-csharp-fixtures] nugetgallery repo not found: ${NUGETGALLERY_ROOT}. ` +
        `Clone with: git clone --depth 1 https://github.com/NuGet/NuGetGallery.git ${NUGETGALLERY_ROOT}`,
    );
    process.exit(1);
  }

  const eshoponwebCommit = getRepoHeadSha(ESHOPONWEB_ROOT);
  const nugetgalleryCommit = getRepoHeadSha(NUGETGALLERY_ROOT);

  const fixtures: FixtureSpec[] = [
    // ---- asp-net-core (eshoponweb) ----
    {
      framework: 'asp-net-core',
      caseId: 'catalog-context',
      sourcePath: path.join(ESHOPONWEB_ROOT, 'src/Infrastructure/Data/CatalogContext.cs'),
      sourceRepo: ESHOPONWEB_REPO,
      sourceCommit: eshoponwebCommit,
      license: ESHOPONWEB_LICENSE,
    },
    {
      framework: 'asp-net-core',
      caseId: 'base-api-controller',
      sourcePath: path.join(ESHOPONWEB_ROOT, 'src/Web/Controllers/Api/BaseApiController.cs'),
      sourceRepo: ESHOPONWEB_REPO,
      sourceCommit: eshoponwebCommit,
      license: ESHOPONWEB_LICENSE,
    },
    {
      framework: 'asp-net-core',
      caseId: 'user-controller',
      sourcePath: path.join(ESHOPONWEB_ROOT, 'src/Web/Controllers/UserController.cs'),
      sourceRepo: ESHOPONWEB_REPO,
      sourceCommit: eshoponwebCommit,
      license: ESHOPONWEB_LICENSE,
    },
    {
      framework: 'asp-net-core',
      caseId: 'order-controller',
      sourcePath: path.join(ESHOPONWEB_ROOT, 'src/Web/Controllers/OrderController.cs'),
      sourceRepo: ESHOPONWEB_REPO,
      sourceCommit: eshoponwebCommit,
      license: ESHOPONWEB_LICENSE,
    },
    {
      framework: 'asp-net-core',
      caseId: 'app-identity-db-context',
      sourcePath: path.join(ESHOPONWEB_ROOT, 'src/Infrastructure/Identity/AppIdentityDbContext.cs'),
      sourceRepo: ESHOPONWEB_REPO,
      sourceCommit: eshoponwebCommit,
      license: ESHOPONWEB_LICENSE,
    },

    // ---- asp-net-framework (nugetgallery) ----
    {
      framework: 'asp-net-framework',
      caseId: 'app-controller',
      sourcePath: path.join(NUGETGALLERY_ROOT, 'src/NuGetGallery/Controllers/AppController.cs'),
      sourceRepo: NUGETGALLERY_REPO,
      sourceCommit: nugetgalleryCommit,
      license: NUGETGALLERY_LICENSE,
    },
    {
      framework: 'asp-net-framework',
      caseId: 'errors-controller',
      sourcePath: path.join(NUGETGALLERY_ROOT, 'src/NuGetGallery/Controllers/ErrorsController.cs'),
      sourceRepo: NUGETGALLERY_REPO,
      sourceCommit: nugetgalleryCommit,
      license: NUGETGALLERY_LICENSE,
    },
    {
      framework: 'asp-net-framework',
      caseId: 'pages-controller',
      sourcePath: path.join(NUGETGALLERY_ROOT, 'src/NuGetGallery/Controllers/PagesController.cs'),
      sourceRepo: NUGETGALLERY_REPO,
      sourceCommit: nugetgalleryCommit,
      license: NUGETGALLERY_LICENSE,
    },
    {
      framework: 'asp-net-framework',
      caseId: 'entities-context',
      sourcePath: path.join(NUGETGALLERY_ROOT, 'src/NuGetGallery.Core/Entities/EntitiesContext.cs'),
      sourceRepo: NUGETGALLERY_REPO,
      sourceCommit: nugetgalleryCommit,
      license: NUGETGALLERY_LICENSE,
    },
    {
      framework: 'asp-net-framework',
      caseId: 'credential-entity',
      sourcePath: path.join(NUGETGALLERY_ROOT, 'src/NuGet.Services.Entities/Credential.cs'),
      sourceRepo: NUGETGALLERY_REPO,
      sourceCommit: nugetgalleryCommit,
      license: NUGETGALLERY_LICENSE,
    },
  ];

  let wrote = 0;
  let failed = 0;
  for (const spec of fixtures) {
    if (!fs.existsSync(spec.sourcePath)) {
      console.error(
        `[seed-csharp-fixtures] Source file not found: ${spec.sourcePath}`,
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
        `[seed-csharp-fixtures] ${spec.framework}/${spec.caseId}: wrote ${result.candidateCount} candidates → ${result.fixtureDir}`,
      );
      wrote++;
    } catch (err) {
      console.error(
        `[seed-csharp-fixtures] FAILED ${spec.framework}/${spec.caseId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }
  console.log('');
  console.log(
    `[seed-csharp-fixtures] Done. wrote=${wrote}  failed=${failed}  total=${fixtures.length}`,
  );
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
