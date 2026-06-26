# Tasks — Target-State Decisions-File Import / Template-Completion (Spec 3 of 3)

Dependency order: gateway parser/validation → gateway apply route → frontend box/exclusivity → frontend summary/branch → guard-rail+review.
Verification is ISOLATION-ONLY (gateway Jest / frontend Vitest; frontend whole-repo baseline is RED). Keep the captured-decision envelope + POST `/capture` path unchanged (no new AMS DTO). Implemented in the MAIN LOOP (lean per-task verification, one final scan).

## Task Group 1 — Gateway: tolerant round-trip parser + per-line validation (FR1, FR2)
- [x] 1.0 New pure module `gateway/src/services/architectConversation/decisionsFileImportParser.ts`
- [x] 1.1 Tolerant line parser of the prompt-ready grammar: ignore `##`/`###`/blank lines; per architecture-wide line strip optional `- `, optional backticks around the code, split on first ` = ` OR ` : `, drop a trailing ` (standards: <ref>)`
- [x] 1.2 v1 imports ONLY architecture-wide lines; record per-scope (`### Per-* overrides`) + adhoc/note + Tier-2 sections as "seen, skipped (note)"; Tier-2 parsed-if-present is optional
- [x] 1.3 Per-line validation vs `questionLibrary`: unknown code / value-not-in-`choices` (single-choice) / malformed-or-not-a-stem `{framework,version}` (versioned) / duplicate code → structured error rows (line #, raw, reason); PARTIAL-ACCEPT (valid lines still parsed)
- [x] 1.4 Versioned value parse: split the resolved chip (e.g. `Spring Boot 4.0`) back to `{framework, version}` via the Spec-1 bare-stem helpers; single-choice value must be an exact `choices` member
- [x] 1.5 Jest tests: happy round-trip, hand-simplified line, bad lines (each reason), scope/adhoc skipped-with-note, versioned vs single-choice

## Task Group 2 — Gateway: import apply route + precedence + tier-skip + override summary (FR3, FR4, FR5, FR8)
- [x] 2.0 New route `POST /api/projects/:projectId/target-architectures/:targetArchitectureId/decisions-file-import` (register alongside the manifest route)
- [x] 2.1 Handler: parse+validate (Group 1) → for each valid code write a captured-decision via `postCapturedDecision` with `createdByTask = 'decisions-file-import'` (versioned `{framework,version}` / single-choice string envelope)
- [x] 2.2 Import-wins precedence: append-only supersession (POST a new winning row per code); fetch latest decisions first to build the OVERRIDE SUMMARY (code: prior→new; counts)
- [x] 2.3 Tier-skip: skip any code with an existing `not_applicable`/`system-skip` row (tier-auto-skipped); report skipped codes in the summary
- [x] 2.4 Response: `{ written[], overrides[], skippedTierCodes[], skippedScopeNote, badLines[], allAnswered:boolean }`; FAIL-SOFT per-write (mirror manifest)
- [x] 2.5 Re-import works (re-supersede) — falls out of supersession; covered by a test
- [x] 2.6 Jest tests: full-import writes 51 + allAnswered, subset, override summary, tier-skip ignore-with-note, partial-accept bad lines, re-import supersede

## Task Group 3 — Frontend: import box + mutual exclusivity (FR6)
- [x] 3.0 Frontend API `uploadDecisionsFile(projectId, targetArchitectureId, file)` in a new/existing api module (mirror `targetManifestApi.ts`)
- [x] 3.1 New `DecisionsFileUploadPanel.tsx` (+ css) modelled on `ManifestUploadPanel.tsx` (file input, submit gating, error/summary display)
- [x] 3.2 Mount in `ArchitectConversationTab.tsx` JUST ABOVE `ManifestUploadPanel`; parent-held "active bulk input" state disables the OTHER box's submit + hover tooltip; clearing re-enables
- [x] 3.3 Vitest: box renders + submits; mutual-exclusivity disable+tooltip both directions + clear re-enables

## Task Group 4 — Frontend: summary turn + full-close / subset-continue (FR7)
- [x] 4.0 Render the post-import summary (valid rows reusing the SummaryPanel row presentation + a `from imported file` badge; show overrides, tier-skips, bad lines)
- [x] 4.1 FULL (allAnswered) → offer the existing "Save Conversation" close; SUBSET → continue the normal walk (refresh next question)
- [x] 4.2 Vitest: full vs subset branch; `from imported file` badge; override/skip/bad-line surfacing

## Task Group 5 — Guard-rail + review
- [x] 5.0 Guard-rail: a parsed value is accepted IFF it is a real `questionLibrary.choices` member / valid bare-stem (drift goes red)
- [x] 5.1 Isolation run: gateway Jest (new suites) + `tsc --noEmit` (touched), frontend Vitest (new suites); one mojibake/NUL scan over changed files; gap check vs FR1–FR8
