# Task Breakdown: Version-unknown manifest entries become pending questions (Spec B, design A)

## Overview
Total Tasks: 4 task groups

Gateway + frontend only — no AMS schema/DTO change. Version-unknown manifest
coordinates stop writing captured-decision rows; they become a persisted
pending set on the conversation thread, surfaced FIRST in the next-question
walk (framework pre-chosen), and only written via the normal `/answer` path
once the user confirms the version.

## Task List

### Gateway Data Model

#### Task Group 1: Pending turn kind + thread persistence
**Dependencies:** None

- [x] 1.0 Add the pending-version-confirmation turn kind and persist it on the thread
  - [x] 1.1 Write 2-8 focused tests for the new turn kind + persistence
    - Test that the new `pending-version-confirmations` kind round-trips through `appendTurn` and reloads from `thread.json`
    - Test `assertExhaustiveTurnKind` accepts the new kind (exhaustiveness compile/behaviour check)
    - Test that re-appending replaces (latest-wins) so a single authoritative pending turn is read
    - Limit to 2-8 highly focused tests; skip exhaustive payload-shape permutations
  - [x] 1.2 Extend the closed turn union in `gateway/src/services/architectConversation/turnShape.ts`
    - Add the new member to `ConversationTurnKind`
    - Add the typed payload interface and a member to the `ConversationTurn` union
    - Add the new kind to `assertExhaustiveTurnKind`
    - Follow the existing `tier-confirmation` typed-payload precedent exactly
    - Payload fields per entry: `decisionCode`, pre-chosen `framework` stem, `sourceFile`, `sourceQuote`/evidence, service/module `tag` (all available on `ManifestAnswerCandidate`); payload carries the full pending set
  - [x] 1.3 Wire writing/replacing the pending turn via `gateway/src/services/targetStateConversationStore.ts`
    - Use the existing `appendTurn` against the opaque `turns` envelope in `thread.json`
    - Do NOT extend the `appendTurn` / store helper signature
    - Recompute-and-REPLACE semantics so latest-wins yields one authoritative pending turn
  - [x] 1.4 Ensure data-model tests pass
    - Run ONLY the 2-8 tests written in 1.1, using the gateway's own test runner in isolation
    - Do NOT run the whole-repo test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass under the gateway test runner in isolation
- New turn kind is part of the closed union in all three places (`ConversationTurnKind`, `ConversationTurn`, `assertExhaustiveTurnKind`)
- Pending turn persists to and reloads from `thread.json`; re-write replaces (latest-wins)
- No change to `appendTurn` signature; no AMS change

### Gateway Auto-Answer Write Path

#### Task Group 2: Stop the version-unknown write, emit pending
**Dependencies:** Task Group 1

- [x] 2.0 Divert the version-unknown branch to emit a pending entry instead of capturing
  - [x] 2.1 Write 2-8 focused tests for the diverted write path
    - Test a `version === VERSION_UNKNOWN` candidate SKIPS `postCapturedDecision` / `buildManifestCapturedDecisionBody` and is collected into the pending set on the outcome
    - Test a concrete-version candidate is UNCHANGED (still builds the body and POSTs the row)
    - Test a single-choice (non-versioned) candidate is UNCHANGED
    - Test re-upload precedence: (a) pending re-uploads CONCRETE -> concrete capture + cleared from recomputed pending; (b) already-captured CONCRETE + later version-unknown -> no retraction, no pending entry; (c) already MANUAL -> manual wins, no pending entry
    - Test a skipped pending entry does NOT count toward `rowsWritten` / partial-failure handling
    - Limit to 2-8 highly focused tests
  - [x] 2.2 Divert the version-unknown branch in `runManifestAutoAnswer` (`gateway/src/services/targetManifest/manifestAutoAnswerer.ts`, ~409-470)
    - For each candidate whose `version === VERSION_UNKNOWN`, SKIP `postCapturedDecision` / `buildManifestCapturedDecisionBody`
    - Collect skipped candidates into a pending set on the outcome (alongside `writtenCodes`)
    - Leave the concrete-version and single-choice branches untouched
    - Do not let a skipped pending entry count toward `rowsWritten` or partial-failure handling
  - [x] 2.3 Recompute + persist the pending set on every upload
    - Build pending entries from `ManifestAnswerCandidate` fields (`decisionCode`, `framework`, `sourceFile`, `sourceQuote`, `tag`)
    - Persist via the Task Group 1 turn-write (replace, idempotent, single authoritative pending turn)
  - [x] 2.4 Honour re-upload precedence consistent with `manifestPrecedence.ts`
    - Reuse `dedupeCandidatesByPrecedence` (concrete beats `version-unknown`) and manual-wins semantics
    - Check captured-row presence before adding a coordinate to the recomputed pending set (rules 5a/5b/5c)
  - [x] 2.5 Ensure write-path tests pass
    - Run ONLY the 2-8 tests written in 2.1, using the gateway's own test runner in isolation
    - Do NOT run the whole-repo test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass under the gateway test runner in isolation
- Version-unknown candidates write NO captured-decision row and appear in the recomputed pending set
- Concrete-version and single-choice candidates behave exactly as today
- Re-upload rules (a)/(b)/(c) hold; pending entries never count toward `rowsWritten`

### Gateway Next-Question Walk

#### Task Group 3: Surface pending FIRST; keep pending excluded from answered/prompt-ready/close-gate
**Dependencies:** Task Group 2

- [x] 3.0 Inject pending coordinates ahead of the preset walk and reconcile against captured rows
  - [x] 3.1 Write 2-8 focused tests for pending-first surfacing + exclusion
    - Test pending coordinates are returned FIRST (ahead of the group A..J walk) with the framework pre-chosen, via the existing versioned-question DTO
    - Test a pending coordinate present in `answeredCodes` (now captured/manual/N-A) drops out of the surfaced pending list (latest-wins reconciliation against captured rows)
    - Test confirming via the normal `/answer` path writes the row and clears the coordinate from pending
    - Test pending entries are EXCLUDED from `answeredCodes`, from prompt-ready output (~617-637), and do NOT block the close gate
    - Limit to 2-8 highly focused tests
  - [x] 3.2 Read the latest pending turn in the next-question route (`gateway/src/routes/architectConversation.ts`, ~555-605)
    - In addition to loading captured decisions, read the thread's latest pending turn
    - Return those versioned questions FIRST, framework pre-chosen, reusing the existing versioned-question DTO (`toPendingQuestionDto`)
    - Keep the `phase` signal driven by existing preset-walk exhaustion; pending precedes the preset walk
  - [x] 3.3 Keep the group A..J walk row-driven in `questionSequencer.ts` (`selectNextQuestion`, 67-86)
    - Inject pending ahead of the ordered library walk without making the walk inspect pending state
  - [x] 3.4 Confirm clears pending; reconcile against captured rows
    - Confirming via the existing `/answer` path + `targetStateCapturedDecisionsWriter` writes the normal `{ framework, version }` row once
    - On the next derive, filter out coordinates that now have a captured row (row presence wins); "Not applicable" follows the same drop-from-pending behaviour
  - [x] 3.5 Keep pending EXCLUDED from answered / prompt-ready / close-gate
    - `answeredCodes` (~578) stays built from captured-row presence; do NOT add pending codes to it
    - Prompt-ready output (~617-637) and the close gate stay row-presence driven and MUST NOT count pending as answered
    - Closing without confirming leaves the coordinate unanswered (no row) and it re-appears as pending on reopen
  - [x] 3.6 Ensure walk tests pass
    - Run ONLY the 2-8 tests written in 3.1, using the gateway's own test runner in isolation
    - Do NOT run the whole-repo test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass under the gateway test runner in isolation
- Pending coordinates are asked FIRST with framework pre-chosen via the existing DTO
- Confirming writes the row and clears it from pending; reconciliation against captured rows holds
- Pending is excluded from `answeredCodes`, prompt-ready output, and the close gate

### Frontend

#### Task Group 4: Read-only pending affordance + informational pending count
**Dependencies:** Task Groups 1-3 (consumes the pending turn + pending-first DTO)

- [x] 4.0 Update `ManifestUploadPanel` and confirm the in-conversation pending question renders
  - [x] 4.1 Write 2-8 focused tests for the pending UI
    - Test `AutoAnsweredDecision` renders version-unknown rows READ-ONLY as "Pending version confirmation — confirm in the conversation" (no inline edit, no manual `captureAnswer` write)
    - Test inline edit is still rendered for concrete auto-answered rows
    - Test the informational "Pending version confirmation (N)" list/count renders separate from Decisions Captured
    - Test the conversation pending-first question renders via the existing `VersionedAnswerControl` with the framework pre-selected
    - Limit to 2-8 highly focused tests
  - [x] 4.2 Make version-unknown rows read-only in `ManifestUploadPanel.tsx` `AutoAnsweredDecision` (~582-730)
    - Remove the inline edit / "Edit to supply the exact version" affordance for version-unknown rows
    - Remove the competing manual `captureAnswer` write for unknown rows
    - Render read-only "Pending version confirmation — confirm in the conversation"
    - Keep inline edit ONLY for concrete auto-answered rows
  - [x] 4.3 Surface the informational pending count
    - Add a "Pending version confirmation (N)" list/count, separate from Decisions Captured
    - Reuse the existing `onUploaded -> refreshEnvelope / refreshNextQuestion` wiring in `ArchitectConversationTab.tsx` to refresh the pending surface
  - [x] 4.4 Confirm the pending-first conversation question renders via `VersionedAnswerControl`
    - The pending-first question (framework pre-selected, version field to fill) renders through the existing `VersionedAnswerControl` (via `ConversationMainPane.tsx`) — no new control
  - [x] 4.5 Ensure frontend tests pass IN ISOLATION
    - The whole-repo frontend tsc/lint baseline is pre-existingly RED on main; verify IN ISOLATION (touched files + relevant component tests) — do NOT rely on a clean whole-repo build
    - Run ONLY the 2-8 tests written in 4.1 plus tsc/lint scoped to the touched files
    - Do NOT run the whole-repo frontend build/lint as a pass/fail gate

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass in isolation
- Version-unknown rows are read-only "Pending version confirmation — confirm in the conversation"; concrete rows keep inline edit
- Informational "Pending version confirmation (N)" is surfaced separate from Decisions Captured
- Pending-first question renders via the existing `VersionedAnswerControl` with framework pre-selected
- Touched files pass scoped tsc/lint; verification does not depend on the (red) whole-repo build

## Execution Order

Recommended implementation sequence:
1. Gateway Data Model — Pending turn kind + thread persistence (Task Group 1)
2. Gateway Auto-Answer Write Path — Stop the version-unknown write, emit pending (Task Group 2)
3. Gateway Next-Question Walk — Surface pending FIRST + exclusions (Task Group 3)
4. Frontend — Read-only pending affordance + informational count (Task Group 4)

Groups 1 -> 2 -> 3 are SEQUENTIAL: they touch shared gateway files
(`turnShape.ts`, `targetStateConversationStore.ts`, `manifestAutoAnswerer.ts`,
`architectConversation.ts`, `questionSequencer.ts`) and each builds on the
prior group's contract, so they must not run in parallel. Group 4 (frontend)
depends on the gateway contract (pending turn + pending-first DTO) and can
follow once groups 1-3 are in place.

Verification note: gateway groups (1-3) run the gateway's own test runner in
isolation. The frontend group (4) verifies IN ISOLATION (touched files +
relevant component tests + scoped tsc/lint) because the whole-repo frontend
tsc/lint baseline is pre-existingly RED on main — never rely on a clean
whole-repo build as a pass/fail gate.
