# Requirements (research findings) — AMS Test Infrastructure Cleanup

These are the *new technical constraints* the research phase surfaced. The raw-idea
already covers product intent, the eight open questions, and the verification
anchors; this file only records things the implementer / shape-spec phase needs
to know that aren't already in the raw-idea.

## Authoritative broken-file inventory (captured 2026-05-25)

Source command (run from `architecture-model-service/`):

```
mvn test-compile -DskipTests=false -Dmaven.test.skip=false \
                 -Dtests.skip=false -Dmaven.compiler.failOnError=true
```

Full log: `planning/test-compile-baseline.log` (and the longer-cap variant
`test-compile-baseline-full.log`).

**18 files surfaced**, with **100 reported errors**. The javac error count is
capped at 100 by default and the `maven.compiler.maxErrors` / `-Xmaxerrs`
overrides were not honoured under the current plugin config, so **the real
broken-file count may be higher** — further files will surface as the
visible-100 are fixed. The shape-spec should plan for one or two extra
test-compile passes during the work.

Visible 18:

```
controller/ModelControllerTest.java
controller/ProductSummaryControllerTest.java
controller/SequenceDiagramControllerTest.java
dto/ExpandResolveDtoTest.java
integration/BusinessLogicIntegrationTest.java
integration/InterfaceDiscoveryIntegrationTest.java
migration/DataEntityPointFkColumnsMigrationTest.java          [already @Disabled]
migration/WorkItemExternalUrlMigrationTest.java
model/dto/MetaModelDtoExtensionTest.java
service/ContextBundleExpansionServiceDiagramTest.java
service/DiscoveryRunServiceScopedConfigOptionalTest.java
service/ImplementContextResolutionServiceTest.java
service/ModelServiceArchitectureScopedSaveTest.java
service/ModelServiceSaveTest.java                             [NEW vs raw-idea]
service/ModelServiceUserJourneyGapTest.java
service/TypedContentCreateSaveFlowTest.java
service/UserJourneyLinkGapFillTest.java
service/UserJourneySyncServiceTest.java
```

Two new entries vs the raw-idea inventory:

- `service/ModelServiceSaveTest.java` (588 lines) — direct `new ModelService(...)`
  call. Current production `ModelService` constructor has gained ~17 repository
  arguments (Environment / CloudAccount / Location / Network / Subnet /
  ComputeCluster / ComputeResource / DeploymentUnit / LoadBalancer / Listener /
  DataStoreInstance / InfrastructureResource / InfrastructurePoint / +
  ResourceSubnetHosting / DeploymentUnitComputeResource /
  LoadBalancerResourceRoute / ApplicationComputeDeployment /
  DataEntityDataStoreHosting / ApplicationInfrastructureResourceUse /
  ApplicationLoadBalancerExposure / IaCSource / IaCResourceBinding / Library /
  CodeUnitDependency / DiscoveryRun) from the infrastructure-domain-backend-foundation
  spec onward. Fix is mechanical-but-tedious: pad the constructor call. Or
  refactor to `@InjectMocks` to immunise against future drift.
- `service/ImplementContextResolutionServiceTest.java` — 9 UUID/String drift
  errors.

## Surprising findings

### Finding 1: `@Disabled` files don't prevent compile errors

`migration/DataEntityPointFkColumnsMigrationTest.java` is already
`@Disabled(...)` with a comment pointing to the newer covering tests
(`DataEntityPointFkSnapshotIntegrationTest` + `DataEntityPointIntegrationTest`),
yet it still fails compile. This file is a textbook **delete** candidate and
also a real-world counter-example to the "leave it @Disabled" half-measure the
raw-idea explicitly rules out.

`integration/DataEntityPointFkSnapshotIntegrationTest.java` is also
`@Disabled` (passes compile though). Worth flagging: the raw-idea forbids
adding new `@Disabled`, but the spec does not say what to do with the two
pre-existing `@Disabled` files in the tree. They are not in the broken list
(except the migration one above), so they would survive untouched. **Open
question: should the cleanup also delete the pre-existing `@Disabled` files
since they document their own redundancy?** (Added as Q9 below.)

### Finding 2: Not all "migration tests" are one-shot

Raw-idea Q8 proposes defaulting Liquibase migration tests to delete. But:

- `migration/WorkItemExternalUrlMigrationTest.java` uses reflection on
  `WorkItemEntity` to assert the `externalUrl` field exists and is mapped to
  `external_url`. This is a **permanent regression invariant**, not a one-shot
  changeset verifier — if someone deletes the field, this test catches it.
  Should be **fix**, not delete.
- `migration/DataEntityPointFkColumnsMigrationTest.java` is a textbook
  one-shot, already disabled and documented as superseded. Should be **delete**.

So the right rule is more nuanced than raw-idea Q8 suggests: **default to
delete only if the file is already `@Disabled` and points to a newer covering
test, OR if its assertions are about a specific Liquibase changeset run rather
than persistent entity invariants.** Implementer should be told to skim the
class Javadoc before applying the default.

### Finding 3: ModelServiceArchitectureScopedSaveTest is missing constants, not drifted

The 30+ "cannot find symbol" errors in
`service/ModelServiceArchitectureScopedSaveTest.java` are not record-constructor
drift — they're `PROJECT_ID`, `ARCH_A`, `ARCH_B`, `FILENAME` references where
the constants were **never declared** in the class. The fix is to add the
constants (`private static final UUID PROJECT_ID = UUID.randomUUID();` etc).
Trivial. The file's behaviour (cross-architecture save bug regression test) is
otherwise still relevant.

### Finding 4: `jira-service/pom.xml` has the same flags

`jira-service/pom.xml` lines 24-25 also pin `<maven.test.skip>true</maven.test.skip>`
and `<tests.skip>true</tests.skip>`. **Out of scope for this spec by name**
(spec title is "AMS test infrastructure cleanup"), but worth knowing the same
pattern is replicated in another module — implies a future
`jira-service-test-infrastructure-cleanup` spec.

### Finding 5: No CI yaml in this repo

Searched for `.github/`, `.circleci/`, `*ci*.yml`. None found. So raw-idea Q5
("should this spec hunt down a CI yaml that also pins skip flags?") is moot —
there's nothing to hunt down. Answer effectively N/A.

### Finding 6: Test fixtures look clean

`src/test/resources/application.yml` configures H2 in PostgreSQL mode with
`liquibase.enabled: false` and `hibernate.ddl-auto: create-drop`. No Liquibase
coupling at runtime — H2 builds the schema from JPA entities. No surprises
that would block the flag removal at runtime; the only runtime risk is the
expected one (some compile-fixed tests may still fail behaviourally).

## Things the shape-spec should plan for

1. **Multiple test-compile passes.** Because of the 100-error javac cap, the
   working set will probably grow after the first pass of fixes. Build the
   triage workflow as an iterative loop: compile → triage new errors → fix /
   delete → compile → repeat, until clean. Don't promise "X files total" in
   the spec scope.
2. **`ModelServiceSaveTest` and `ModelServiceArchitectureScopedSaveTest` are
   the long-pole fixes.** Both touch the giant `ModelService` constructor.
   Recommend refactoring both to use `@InjectMocks` + `ReflectionTestUtils`
   (the latter is already doing this) rather than direct `new ModelService(...)` —
   immunises against the next infrastructure-domain spec adding more repos.
3. **`triage-decisions.md` schema.** Each entry should record: file path,
   fix-or-delete, rationale (for deletes: which newer test covers the
   scenario; for fixes: nature of drift), and (for fixes) runtime-pass-or-fail
   outcome. The shape-spec should give the implementer this template
   up-front so the audit file is consistent.
4. **Pre-existing `@Disabled` cleanup decision.** Tied to Q3 below. The shape
   should state explicitly whether the two pre-existing `@Disabled` files
   stay or go; otherwise the implementer will guess inconsistently.

## Accepted answers to clarifying questions (2026-05-25)

User accepted all defaults. Decisions to encode in the spec:

- **Q1 Triage authority.** Implementer deletes inline; each delete logged in
  `triage-decisions.md`. One PR.
- **Q2 Runtime failures budget.** Threshold ~20. Above that, the spec adds a
  `@Disabled("follow-up #...")` pass on the worst offenders before landing;
  each disable gets a one-line follow-up entry in `triage-decisions.md`.
- **Q3 Pre-existing `@Disabled` files.** Delete both
  (`migration/DataEntityPointFkColumnsMigrationTest.java` — already in the
  broken list — and `integration/DataEntityPointFkSnapshotIntegrationTest.java`
  — compiles but disabled). Record in `triage-decisions.md`.
- **Q4 Migration-test triage rule.** Default delete *only* if file is already
  `@Disabled` pointing to a covering test OR assertions are about a specific
  changeset run rather than persistent entity invariants. Otherwise default
  fix. Implementer must skim class Javadoc before applying the default.
- **Q5 `ModelService`-constructor tests.** Refactor `ModelServiceSaveTest` to
  `@InjectMocks` + `ReflectionTestUtils` (matches `ModelServiceArchitectureScopedSaveTest`'s
  pattern). Immunises against the next infrastructure-domain spec adding more
  repos.
- **Q6 Working-set discovery.** Iterate `compile → triage → fix → compile`
  until clean. Do NOT touch `maven-compiler-plugin` config to bump the
  `-Xmaxerrs` cap.
- **Q7 `triage-decisions.md` template.** Columns:
  `file path | fix|delete | rationale (deletes: covering-test path; fixes: nature of drift) | runtime-passed | runtime-failed (follow-up note) | not-run`.
  Stays in spec folder forever as audit trail.
- **Q8 Fixed-file runtime green-ness.** For each fixed file, attempt
  `mvn test -Dtest=...` and record outcome. Runtime failure does NOT block
  the spec — logged under "Compiles but fails at runtime" in
  `triage-decisions.md`.
- **Q9 Production-bug discovery.** Record in `triage-decisions.md` under
  "Production bugs found, deferred to follow-up". Do NOT fix in this spec.
  Implementer may write a fresh `raw-idea.md` for the follow-up while context
  is fresh, in the appropriate dated spec folder.
- **Q10 Test execution speed.** Slower `mvn install` accepted as the cost of
  having tests actually run. No optimisation work this spec.

**Dropped from raw-idea:** Q5 (CI yaml hunt) — no CI yaml in this repo, moot.
