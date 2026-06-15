Spec 2 of a 4-spec migration auto-flow program — "Holistic Integration/E2E TEST Work Items".

GOAL: After a feature's (or epic's) stories have implementation-ready specs (Spec 1), run a holistic Test-Engineer review across the children's specs to define a SMALL number of cross-cutting INTEGRATION and E2E tests, and create them as first-class TEST-type work items placed as SIBLINGS (children of the feature alongside its stories; or children of the epic alongside its features). Each TEST item gets its OWN implementation-ready spec (the test plan) so it is IMPLEMENTED via the Migrate loop (Spec 3) — Claude Code writes the actual integration/E2E test CODE, which joins the test suite and is executed in Verification (Spec 4). TEST items are NOT mere verification-time definitions — their deliverable is real automated test code.

KEY WORK:
- Generalize the existing holistic test prompt gateway/src/services/holisticTestPlanningPrompt.ts (currently feature-level: reviews stories' specs, emits ONLY integration|e2e, never repeats unit/functional, returns empty if none warranted) to run on a FEATURE (review its stories) OR an EPIC (review its features) — a small generalization (review the immediate children's specs). Inputs: each child's StorySpecSummary (scope/AC/impl-plan/unit+functional tests) + the level's context + TEST-STRATEGY.MD.
- A user-triggered action (per feature/epic) that runs the holistic review once the children are spec-complete; produces a small set of {title, description, type: integration|e2e} test definitions.
- Create TEST-type work items (WorkItem.type is free-text = "TEST") as SIBLINGS: parentId = the feature (sibling to its stories) or the epic (sibling to its features); test definition (title/description/type) onto the item; status PLANNED; sortOrder after the stories/features they span.
- Each TEST item also gets an implementation-ready spec (reuse Spec 1's generator path / a migration_story_spec_generations row, book_of_work_id nullable) whose body instructs Claude Code to WRITE the integration/E2E test code aligned to TEST-STRATEGY.MD. So TEST items are first-class IMPLEMENTABLE work items.
- Surface TEST items in the plan/backlog tree as siblings, visibly distinguishable as TEST type.
- Sequencing note: TEST items are implemented AFTER the stories they span (the Migrate loop in Spec 3 orders them after their covered children).

LOCKED DECISIONS: small number suffices (the prompt naturally returns few/empty — no fabrication of unneeded tests); generated at SPEC time (reviewable before Migrate); executed in Verification (Spec 4); TEST items ARE implemented (test code built) through the Migrate loop, exactly like stories.

OWNERS: gateway (holistic generation + level generalization + per-TEST-item implementation-ready spec via Spec 1's path); architecture-model-service/AMS (create TEST work items as siblings; their spec rows; new Liquibase changesets ONLY — latest applied 180; snake_case wire; boxed PATCH-mutable types); frontend (display TEST items in the plan/backlog tree + review surface).

OUT OF SCOPE: per-story unit/functional tests (Spec 1); the Migrate button + Driver + auto-answerer that IMPLEMENTS these TEST items (Spec 3); Verification execution (Spec 4).

REUSE: holisticTestPlanningPrompt.ts (the harvest source, generalize to feature|epic); the WorkItem create + parentId/sibling/sortOrder model; Spec 1's enriched generator path for each TEST item's implementation-ready spec; the existing backlog/plan tree display.
