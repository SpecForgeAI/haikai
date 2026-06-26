# Final Verification — Target-State Decisions-File Import (Spec 3 of 3)

**Verdict: ✅ PASS** (verified in isolation; built main-loop, lean). Date: 2026-06-26.

The frontend whole-repo tsc/lint baseline is pre-existingly RED (unrelated) — NOT run, per the isolation mandate. Gateway type-safety is covered by ts-jest compiling the new modules + their imports as the suites run.

## Isolation test evidence

- **Gateway (Jest):** `src/routes/__tests__/decisionsFileImport.test.ts` — **11/11 pass** (parser FR1/FR2 + apply handler FR3/FR4/FR5/FR8). ts-jest type-checked `decisionsFileImportParser.ts` + `decisionsFileImport.ts` as it ran.
- **Frontend (Vitest):** new `DecisionsFileUploadPanel.test.tsx` — **5/5**; touched `ManifestUploadPanel.test.tsx` — **8/8**; full regression of `src/components/targetState/architectConversation` — **27 files / 127 tests pass** (incl. `ArchitectConversationTab.test.tsx` + `cascadeOverrideSync`, which render the tab with the new wiring).
- **Mojibake / NUL scan** across all 11 changed/new files: **clean**. EOL preserved.

## Requirement coverage (FR1–FR8)

| FR | What | Where | Test |
|----|------|-------|------|
| FR1 | Tolerant round-trip parser of the prompt-ready grammar (optional `- `/backticks, `=` or `:`, ignore headers/blank, drop ` (standards:)`; arch-wide only; other sections skipped-with-note; chip→`{framework,version}` reversal via ported `deriveBareStem`) | `gateway/.../decisionsFileImportParser.ts` | parse round-trip, hand-simplified, standards/version-unknown, partial-accept |
| FR2 | Per-line validation vs `questionLibrary` + partial-accept, all errors at once (unknown_code / value_not_in_choices / malformed / duplicate_code) | parser | partial-accept test (4 reasons) |
| FR3 | Apply via existing `postCapturedDecision`, `createdByTask='decisions-file-import'`, versioned/single-choice envelope | `gateway/src/routes/decisionsFileImport.ts` | writes + envelope assertions |
| FR4 | Import-wins append-only supersession + override summary (prior→next) | handler | override summary test |
| FR5 | Cross-project tier-mismatch ignore-with-note (existing `not_applicable` row) | handler | tier-skip test |
| FR6 | New "Manually Answer Target State" box above `ManifestUploadPanel`; mutual exclusivity on BOTH (disable + tooltip; clear re-enables) | `DecisionsFileUploadPanel.tsx` + surgical `ManifestUploadPanel.tsx` (`disabledReason`/`onActiveChange`) + `ArchitectConversationTab.tsx` (lifted active state) | active-reporting + disabled-state tests |
| FR7 | Net-new summary turn (rows + `from imported file` badge); full→Save Conversation / subset→continue | `DecisionsFileUploadPanel.tsx` | full vs subset; overrides/tier-skip/sections/bad-lines surfaced |
| FR8 | Re-import re-supersedes | handler | re-import test |

## Wiring + cross-cutting

- Route mounted on `architectConversationRouter` alongside the manifest route (`registerDecisionsFileImportRoute`); **Vite proxy** alternation extended to `decisions-file-import` (avoids the AMS-404 class of bug).
- Captured-decision envelope + POST `/capture` path **unchanged**; **no new AMS DTO**.
- Guard-rail: the parser derives its per-code choice/stem sets from the LIVE `questionLibrary` at load — validation can't drift from the library (no hardcoded values).
- Fail-soft: per-write failures (`failedCodes`) and a decisions-read hiccup both degrade without blocking the import.

## Non-blocking notes
- v1 scope: imports the 51 architecture-wide answers; per-scope/adhoc/Tier-2 sections are reported-and-skipped. LLM fallback for loose files deferred (v2 seam), per the shaped requirements.
- Frontend whole-repo tsc not run (pre-existing RED baseline) — out of scope, not a failure.
