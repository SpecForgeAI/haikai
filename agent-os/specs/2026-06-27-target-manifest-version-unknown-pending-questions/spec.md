# Specification: Version-unknown manifest entries become pending questions (Spec B, design A)

## Goal
Stop writing a fully-captured `version-unknown` decision row on manifest upload; instead carry version-unknown coordinates as a persisted pending set that the conversation asks FIRST (framework pre-chosen), only writing the captured row once the user confirms the version.

## User Stories
- As an architect, I want libraries detected in the manifest but missing a version to be the first things I am asked to confirm (with the library already chosen), so I just supply the version.
- As an architect, I want unconfirmed version-unknown items to NOT count as captured decisions, so my "Decisions Captured" count and prompt-ready output reflect only real answers.

## Specific Requirements

**Stop the version-unknown captured-decision write**
- In `manifestAutoAnswerer.ts` `runManifestAutoAnswer` (~409-470), for each candidate whose `version === VERSION_UNKNOWN`, SKIP `postCapturedDecision` / `buildManifestCapturedDecisionBody`.
- Concrete-version candidates are UNCHANGED: still build the body and POST the captured-decision row exactly as today.
- Single-choice (non-versioned) candidates are also unchanged — only the versioned `version-unknown` branch is diverted.
- Collect the skipped version-unknown candidates into a pending set on the outcome so the caller can persist it (alongside `writtenCodes`).
- Do not let a skipped pending entry count toward `rowsWritten` or partial-failure handling.

**New persisted pending turn kind**
- Add a new closed-union member (e.g. `pending-version-confirmations`) to `ConversationTurnKind` + a payload interface + the `ConversationTurn` union in `turnShape.ts` (currently a closed 20-kind union).
- Payload carries the full pending set; each entry holds `decisionCode`, pre-chosen `framework` stem, `sourceFile`, `sourceQuote`/evidence, and the service/module `tag` (all available on `ManifestAnswerCandidate`).
- Persist via the existing `targetStateConversationStore` `appendTurn` (opaque `turns` envelope in `thread.json`); do NOT extend the store helper signature.
- The set is recomputed and REPLACED on every upload (idempotent, single authoritative pending turn read by latest-wins); survives reload with no AMS change.

**Surface pending coordinates FIRST in the next-question walk**
- In `architectConversation.ts` next-question route (~555-605), read the latest pending set from the thread and inject those coordinates AHEAD of the group A..J walk in `selectNextQuestion` (`questionSequencer.ts:67-86`).
- Reuse the EXISTING versioned-question DTO (`toPendingQuestionDto`) with the framework pre-chosen so only the version field needs filling — NO new "confirm version" turn type or DTO.
- A pending coordinate already present in `answeredCodes` (now captured/manual/N-A) must drop out of the surfaced pending list (latest-wins reconciliation against captured rows).
- The `phase` signal stays driven by the existing preset-walk exhaustion; pending items precede the preset walk.

**Confirm via the normal /answer capture path**
- Confirming the version routes through the existing `/answer` capture path + `targetStateCapturedDecisionsWriter`, writing the normal `{ framework, version }` row once.
- After capture, the coordinate is naturally excluded from pending (row presence wins on the next derive) — no separate pending mutation required, but ensure the pending list filters out coordinates with a captured row.

**Exclude pending from answered / prompt-ready / close-gate**
- `answeredCodes` (`architectConversation.ts:578`) remains built from captured-decision row presence — since no row is written for pending, they are already excluded; do not add pending codes to it.
- Prompt-ready output (~617-637) and the close gate stay row-presence driven and MUST NOT count pending entries as answered.
- Closing without confirming leaves the coordinate unanswered (no row), does NOT block close, and re-appears as pending on reopen (derived from the persisted pending turn).

**Opt-out / Not applicable behaviour**
- "Not applicable" on a pending coordinate captures via the normal not_applicable path and the coordinate drops from pending (captured row now exists for the code).
- No special-case blocking; the existing close gate is unchanged.

**Manifest re-upload reconciliation**
- (a) pending coordinate that re-uploads as CONCRETE → auto-answer + capture via the normal concrete path and clear it from the recomputed pending set.
- (b) coordinate ALREADY captured CONCRETE → a later `version-unknown` upload does NOT retract the concrete row and creates NO pending entry.
- (c) coordinate already MANUALLY confirmed → manual wins, no pending entry.
- Mirror `dedupeCandidatesByPrecedence` (concrete beats `version-unknown`) and `manifestPrecedence` manual-wins; check captured-row presence before adding a coordinate to the recomputed pending set.

**Frontend: read-only pending affordance in ManifestUploadPanel**
- In `ManifestUploadPanel.tsx` `AutoAnsweredDecision` (~582-730), STOP rendering version-unknown rows as editable (remove the inline edit / "Edit to supply the exact version" affordance and the competing manual `captureAnswer` write for unknown rows).
- Render version-unknown rows read-only as "Pending version confirmation — confirm in the conversation".
- Keep inline edit ONLY for concrete auto-answered rows.

**Informational pending count surfacing**
- Surface the pending set as an INFORMATIONAL "Pending version confirmation (N)" list/count, separate from "Decisions Captured".
- EXCLUDE pending entries from the answered count and from prompt-ready output until confirmed; write NO informational captured row.
- `ArchitectConversationTab.tsx` already refreshes envelope + next-question on upload (`onUploaded -> refreshEnvelope / refreshNextQuestion`) — reuse this to refresh the pending surface.

## Visual Design
No visual assets provided (`planning/visuals/` is empty). This is predominantly gateway behaviour with a small frontend affordance change.

## Existing Code to Leverage

**`gateway/src/services/targetManifest/manifestAutoAnswerer.ts`**
- `runManifestAutoAnswer` / `buildManifestCapturedDecisionBody` (~336-470) is the exact write seam; divert the `version === VERSION_UNKNOWN` versioned branch to emit a pending entry instead of POSTing.
- `ManifestAnswerCandidate` (~100-120) already carries `decisionCode`, `framework`, `version`, `sourceFile`, `sourceQuote`, `tag` — the full pending-entry payload.

**`gateway/src/services/targetStateConversationStore.ts` + `turnShape.ts`**
- Thread envelope `{ schemaVersion, threadId, turns: unknown[] }` + `appendTurn` is the persistence home; `turnShape.ts` owns the closed turn union to extend with the new pending kind (follow the `tier-confirmation` typed-payload precedent).

**`gateway/src/services/architectConversation/questionSequencer.ts` + `routes/architectConversation.ts`**
- `selectNextQuestion` (67-86) walks ORDERED_LIBRARY skipping `answeredCodes`; inject pending coordinates ahead of it. The route builds `answeredCodes` from row presence (578) and serves prompt-ready output (617-637) — both stay row-driven, so pending stays excluded.

**`gateway/src/services/targetManifest/manifestPrecedence.ts`**
- `dedupeCandidatesByPrecedence` (concrete-over-unknown) + manual-wins supersede logic; `recomputeResolvedTargetVersions` (~196+) passes `version-unknown` through. Reuse these semantics for the re-upload reconciliation rules.

**`frontend/.../ManifestUploadPanel.tsx` + `VersionedAnswerControl` / `versionControlConfig.ts`**
- `AutoAnsweredDecision` (582-730) currently inline-edits unknown rows via a manual `captureAnswer` write — remove for unknown rows. `VersionedAnswerControl` (via `ConversationMainPane.tsx`) already supports a pre-chosen framework stem + version field — reuse for the in-conversation confirm.

## Out of Scope
- Any AMS schema/DTO change, including a persisted "pending" status field on captured-decision rows.
- Any change to concrete-version manifest auto-answer behaviour (write path unchanged).
- Any new "confirm version" turn type, DTO, or frontend control.
- Spec A (right-panel UX — already built: right-column reorder, resizable column, scroll fix, Title-Case headings) — do not conflict with those changes.
- Spec C (live vuln recompute / OSV bridge / logging), beyond confirmed versions flowing through the normal capture path (which benefits C's version sourcing).
- Changing `recomputeResolvedTargetVersions` passthrough of `version-unknown` (Spec C hand-off source).
