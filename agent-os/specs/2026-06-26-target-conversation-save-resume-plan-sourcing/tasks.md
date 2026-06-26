# Task Breakdown: Target-State Conversation — Save, Resume, and Plan Sourcing Decoupled from "Active"

## Overview
Total Tasks: 6 task groups

Sources from one chosen saved target-state conversation (default most-recent-saved) instead of the "active" target, makes a conversation saveable/resumable/listable, and adds a non-blocking pre-flight readiness panel to the plan wizard.

**Verification note:** Gateway = Jest, Frontend = Vitest, AMS = JUnit + changeset test. The whole-repo frontend baseline is RED — verify all frontend/gateway work in isolation (run only the specific spec files), never the full suite.

## Task List

### AMS Layer

#### Task Group 1: Save-marker column + DTO (AMS foundation)
**Dependencies:** None

- [x] 1.0 Add the `conversation_saved_at` marker end-to-end through the AMS persistence + DTO layer
  - [x] 1.1 Write 2-8 focused tests (run ONLY these)
    - Changeset test mirroring the existing AMS changeset-test convention (TIMESTAMPTZ → H2 alias): assert `architecture.conversation_saved_at` exists and is nullable after changelog runs
    - Mapper/DTO test: a persisted `ArchitectureEntity` with `conversationSavedAt = null` maps to `ArchitectureDto.conversationSavedAt = null`; a stamped instant round-trips
    - Skip exhaustive column/precondition permutations
  - [x] 1.2 Add nullable boxed `Instant conversationSavedAt` to `ArchitectureEntity.java`
    - `@Column(name = "conversation_saved_at")`, modelled EXACTLY on `lastMarkedStaleAt` (`ArchitectureEntity.java:131`)
    - Boxed `Instant` (never primitive) so a null-safe PATCH preserves the column
  - [x] 1.3 Create Liquibase changeset `203-architecture-conversation-saved-at.sql`
    - `ALTER TABLE architecture ADD COLUMN conversation_saved_at TIMESTAMPTZ NULL` — no backfill
    - Use `198-architecture-proceed-critical-override.sql` as the template
    - Register in `db.changelog-master.yaml` AFTER `202`, with the not-`columnExists` precondition idiom (`onFail MARK_RAN`), mirroring `198`/`201`/`202`
  - [x] 1.4 Surface `conversationSavedAt` on `ArchitectureDto` + the mapper
    - Add the field to the DTO and the entity→DTO mapping so `listTargets` (`TargetArchitecturePromoteService.java:309-363`) carries the saved indicator/timestamp
    - Confirm wire-naming: follow the DTO's existing convention (snake default vs `@CamelCaseWire` as the sibling DTO uses)
  - [x] 1.5 Run ONLY the 1.1 tests
    - Verify the changelog applies and the DTO mapping passes; do NOT run the full AMS suite

**Acceptance Criteria:**
- The 1.1 tests pass
- `conversation_saved_at` is a nullable TIMESTAMPTZ on `architecture`; existing rows stay null
- `conversationSavedAt` flows entity → DTO and appears in `listTargets` output
- No `conversation_status` column introduced (deferred)

#### Task Group 2: Stamp endpoint + saved finders + saved-id endpoint (AMS)
**Dependencies:** Task Group 1

- [x] 2.0 Add the stamp endpoint, most-recent-saved / list-saved finders, and the saved-id read endpoint
  - [x] 2.1 Write 2-8 focused tests (run ONLY these)
    - Stamp endpoint sets `conversation_saved_at = now()` for a target arch and returns the stamped instant
    - `findFirst…ConversationSavedAtIsNotNullOrderByConversationSavedAtDesc` returns the most-recent-saved (and null when none saved)
    - List-saved finder returns only `conversation_saved_at IS NOT NULL` rows, newest first
    - Saved-id endpoint returns `{ savedTargetArchitectureId: <uuid> }`, and null when none saved
  - [x] 2.2 Add the stamp endpoint
    - `POST /api/projects/{projectId}/target-architectures/{targetArchitectureId}/conversation-saved` setting `conversation_saved_at = now()`, returning the stamped instant
    - Sibling-placed to `ActiveTargetArchitectureController`
  - [x] 2.3 Add the most-recent-saved repository finder
    - `findFirstByProjectIdAndKindAndArchivedFalseAndConversationSavedAtIsNotNullOrderByConversationSavedAtDesc` (LIMIT 1)
    - Model on `findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc` (`ActiveTargetArchitectureController.java:74-80`)
  - [x] 2.4 Add the list-saved repository finder
    - `findByProjectIdAndKindAndArchivedFalseAndConversationSavedAtIsNotNullOrderByConversationSavedAtDesc` (same predicate, no limit) — backs the wizard's saved-conversation picker
  - [x] 2.5 Add the most-recent-saved id read endpoint
    - Mirror `GET .../active-target-architecture-id`; camelCase wire via `@CamelCaseWire`; return `{ savedTargetArchitectureId: <uuid>|null }`
  - [x] 2.6 Run ONLY the 2.1 tests
    - Do NOT run the full AMS suite

**Acceptance Criteria:**
- The 2.1 tests pass
- Stamping a target sets `conversation_saved_at` and that target becomes most-recent-saved
- Both finders honour the `conversation_saved_at IS NOT NULL` + `archived=false` + `kind` predicate, ordered DESC
- Saved-id endpoint returns the camelCase `savedTargetArchitectureId` (null when none)

### Gateway Layer

#### Task Group 3: Resolver decouple from active + save stamp (gateway)
**Dependencies:** Task Groups 1-2

- [x] 3.0 Source decisions/tech-stack/mappings from the resolved saved target and stamp on close
  - [x] 3.1 Write 2-8 focused Jest tests (run ONLY these, in isolation)
    - Both resolvers resolve the most-recent-saved target (default) instead of the active one
    - `target-tech-stack-<id>.md` filename id uses the SAME resolved saved id (decisions + tech-stack cannot diverge)
    - Fallbacks preserved: "no target architecture defined yet" and file-absent sentinel; new `no_saved_conversation` log reason
    - Close handler calls the stamp endpoint after CloseTurn + tech-stack write; stamp failure is fail-soft (surfaced additively, close not aborted)
  - [x] 3.2 Add client functions in `targetStateCapturedDecisionsClient.ts`
    - `fetchMostRecentSavedTargetArchitectureId` over the FR2 saved-id endpoint (mirror `fetchActiveTargetArchitectureId`)
    - Thin stamp client fn for the FR2 stamp endpoint
  - [x] 3.3 Swap the resolver lookup at both sites
    - Replace `fetchActiveTargetArchitectureId` at `contextResolvers.ts:820` (`TargetStateDecisionsContextResolver`) AND `:1100` (`TargetTechStackContextResolver`) with the most-recent-saved resolver
    - Keep the two-state fallbacks/sentinels; keep passing the additive `tier2Facts` into `buildTargetStateDecisionsPromptText` (`:867-868,937-940`), fetched against the resolved saved target
  - [x] 3.4 Redirect the tech-stack filename id
    - Point `target-tech-stack-<id>.md` composition (`contextResolvers.ts:1156`) at the same resolved saved target
    - Update `[diag-gw]` log reasons to reflect saved-target resolution (e.g. `no_saved_conversation`)
  - [x] 3.5 Add the stamp call to the close handler
    - In `architectConversation.ts` close handler (`:836-904`), call the stamp endpoint inside the same try AFTER `appendTurn(CloseTurn)` + `writeTargetTechStackMarkdown` (`:867-896`)
    - Report the outcome additively on the close payload alongside `targetTechStackWrite` (fail-soft; do not abort the close turn)
  - [x] 3.6 Run ONLY the 3.1 tests (in isolation)

**Acceptance Criteria:**
- The 3.1 tests pass
- Both resolvers + the tech-stack filename bind to one resolved saved target; decisions/tech-stack/mappings cannot diverge
- Existing fallbacks, sentinels, and `tier2Facts` plumbing are unchanged in behaviour
- Close persists CloseTurn + tech-stack as before and additionally stamps `conversation_saved_at`, fail-soft

### Frontend Layer

#### Task Group 4: Save action relabel + saved-conversations list + resume (frontend)
**Dependencies:** Task Groups 1-2

- [x] 4.0 Relabel save, list saved conversations, and land/resume view-only
  - [x] 4.1 Write 2-8 focused Vitest tests (run ONLY these, in isolation)
    - Close CTA reads "Save Conversation"; gate met but other decisions incomplete → non-blocking completeness summary + warning, Save still enabled
    - Close gate unchanged: `CLOSE_GATE_CODES` = `service.language` + `api.protocol` + `db.engine` is the minimum; `db.migrations` stays out
    - Target-architectures list shows the saved indicator/filter driven by `conversationSavedAt`
    - A selected saved-conversation draft lands view-only (not fresh-start); "Reopen / continue" resumes the walk
  - [x] 4.2 Relabel close CTA + completeness summary
    - Relabel to "Save Conversation" (the `DecisionsFileUploadPanel.tsx:20` / `CloseConversationFlow.tsx` close CTA)
    - When the gate (`CLOSE_GATE_CODES`, `CloseConversationFlow.tsx:38-77`) is met but other decisions are incomplete, show a non-blocking completeness summary + warning and still allow Save (no hard block beyond the existing gate)
  - [x] 4.3 Extend the target-architectures list with the saved indicator/filter
    - In `TargetArchitectureWorkspace.tsx`, drive a saved-conversation indicator/filter from `conversationSavedAt` (FR2/`ArchitectureDto`) — extend the existing list, do NOT add a parallel section
  - [x] 4.4 Fix the conversation sub-tab landing
    - In `ArchitectConversationTab.tsx:1199-1231`, when the selected draft is a saved conversation, land on the existing `isResumingPrior` view-only transcript pane (`ConversationMainPane`) instead of defaulting to a fresh start
  - [x] 4.5 View-only resume + "Reopen / continue"
    - Opening a saved conversation shows the view-only transcript + decisions/tech-stack with an explicit "Reopen / continue" CTA that resumes the question walk (existing start path); keep "Start new conversation" as a distinct secondary action
  - [x] 4.6 Run ONLY the 4.1 tests (in isolation)

**Acceptance Criteria:**
- The 4.1 tests pass
- Save CTA reads "Save Conversation"; incomplete-but-gated state allows Save with a non-blocking warning; gate unchanged
- Saved conversations are indicated/filterable within the existing target list
- Selecting a saved conversation lands view-only and reopens via "Reopen / continue"

#### Task Group 5: Plan-wizard saved-conversation binding + pre-flight readiness (frontend)
**Dependencies:** Task Groups 1-3

- [x] 5.0 Bind the wizard to a saved conversation and show non-blocking readiness
  - [x] 5.1 Write 2-8 focused Vitest tests (run ONLY these, in isolation)
    - Target `<select>` lists only saved targets (`conversationSavedAt != null`), labelled name + saved date, defaulting to most-recent-saved
    - The single selection drives `targetArchitectureId` for decisions + tech-stack + mappings together
    - Readiness panel renders saved date, answered/total, foundational DB decisions, tech-stack y/n, named gaps
    - Answered/total EXCLUDES `not_applicable`/`deferred` from BOTH numerator and denominator
  - [x] 5.2 Convert the target selector to "pick a saved conversation"
    - `MigrationDeliveryPlanWizard.tsx:732-747`: options filtered to saved targets, labelled name + saved date, default `targetArchitectureId` to most-recent-saved; allow choosing any other saved conversation
    - Current-architecture selector unchanged; the one choice flows into context fetch + downstream stages
  - [x] 5.3 Add the inline pre-flight readiness panel
    - In stage 1 "Inputs & context" (`renderStage1`, `MigrationDeliveryPlanWizard.tsx:703+`, near `mdp-wizard-readiness-card`), non-blocking
    - Shows: saved date · decisions answered/total (excluding `not_applicable`/`deferred`) · foundational DB decisions present (`db.engine`/`db.migrations`) · tech-stack written (y/n) · named gaps
  - [x] 5.4 Reuse the tolerant reader for counting/labelling
    - Use `resolveCapturedAnswerLabel` (`architectConversationApi.ts:160-182`) for the non-uniform `answerValue` envelope (versioned `{value:{framework,version}}`, bare string, wrapped `{value:<string>}`, `string[]`, `not_applicable`/`deferred`); prefer `answerSummary` for labels
    - Do NOT write a new parser
  - [x] 5.5 Run ONLY the 5.1 tests (in isolation)

**Acceptance Criteria:**
- The 5.1 tests pass
- The wizard sources from a chosen saved conversation (default most-recent-saved); one choice unifies decisions/tech-stack/mappings
- The readiness panel is non-blocking and names gaps before generation
- `not_applicable`/`deferred` are excluded from answered/total; no new envelope parser added

### Testing

#### Task Group 6: Cross-tier test review & gap analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical cross-tier gaps only
  - [x] 6.1 Review the tests from Task Groups 1-5
    - Review the focused tests from 1.1, 2.1 (AMS), 3.1 (gateway), 4.1, 5.1 (frontend)
  - [x] 6.2 Analyze coverage gaps for THIS feature only
    - Prioritize the end-to-end save → most-recent-saved → plan-sources-that-target flow and the readiness-exclusion rule
    - Do NOT assess whole-application coverage
  - [x] 6.3 Write up to 10 strategic gap tests maximum
    - e.g. end-to-end: stamping a target makes it most-recent-saved and the plan reads THAT target's decisions/tech-stack/mappings (not the active one)
    - e.g. readiness counts exclude `not_applicable`/`deferred` from numerator and denominator
    - e.g. resolver + tech-stack filename resolve the same saved id (no divergence)
    - Skip edge/performance/accessibility unless business-critical
  - [x] 6.4 Run ONLY the feature-specific tests (in isolation per tier)
    - AMS (JUnit + changeset), gateway (Jest), frontend (Vitest) for this spec's files only
    - Do NOT run the entire application test suite (frontend baseline is red)

**Acceptance Criteria:**
- All feature-specific tests pass across the three tiers
- The save → most-recent-saved → plan-sourcing path is covered end-to-end
- No more than 10 additional tests added
- Testing focused exclusively on this spec's requirements

## Execution Order

Recommended implementation sequence:
1. AMS save-marker column + DTO (Task Group 1)
2. AMS stamp endpoint + finders + saved-id endpoint (Task Group 2)
3. Gateway resolver decouple + save stamp (Task Group 3)
4. Frontend save/resume/list (Task Group 4) — can run in parallel with Group 3 after Group 2
5. Frontend plan-wizard binding + pre-flight readiness (Task Group 5) — needs Group 3
6. Cross-tier test review & gap analysis (Task Group 6)
