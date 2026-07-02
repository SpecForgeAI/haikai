# Spec C — Verbatim DB Specs

**Program:** Persistence-Tier Oracle (see `agent-os/planning/2026-07-02-persistence-oracle-program-decisions.md`)
**Status:** built + verified.
**Closes gap:** #2 second half — pack artifacts flow into the specs byte-for-byte; the LLM
invents nothing for DB build stories (user requirement: "facts/verbatim as HUGE/TOTAL input,
LLM invents little/nothing").

## What was built

**New module `gateway/src/services/migrationDbPackSpecCarriage.ts`** + a deterministic branch in
the shape-spec batch runner (`migrationShapeSpecGenerationHandler.ts`).

- **Recognition:** a story tagged `seed_db_pack_files` carrying `packId` + `packFilePaths` /
  `packFilePathPrefixes` (stamped by Spec -b's deterministic DB expansion; the loader now carries
  these blob extras, mirroring the `sourceCapabilityId` precedent).
- **The carriage path bypasses everything LLM-shaped:** no focused-context resolver, no prompt,
  no response validators, no confidence downgrade. The generated spec text IS the pack's files:
  starts with the required `/agent-os:shape-spec <story title>` prefix, states the
  no-modification rules, then reproduces every selected pack file under
  `### \`<repo-relative path>\`` inside an **unbreakable fence** (fence length = longest backtick
  run in the content + 1, min 4). Selection = exact paths (story order) + prefix matches (pack
  sort order), deduped.
- **Honesty rules:** a selected path missing from the current pack → `insufficient_context` with
  the missing paths in `missingInputsJson` (pack changed since expansion — regenerate the plan);
  pack-files read failure → per-story `failed`; oversized carriage (> 300k chars, e.g. a full
  bulk-script set) is still carried complete with a `db_pack_carriage_large` warning →
  `generated_with_warnings`. Never a spec with silent holes.
- Result rows carry `focusedContextRefsJson = { source: 'db_migration_pack', packId, filePaths }`
  for traceability; `confidence: 'high'` (facts, not inference).

Downstream (unchanged by design): the execution driver's spec-ready gate accepts
`generated`/`generated_with_warnings`, so carriage stories flow into Migrate like any other
spec'd story — IVS receives the files verbatim inside the spec text.

## Verification

9 tests in `migrationDbPackSpecCarriage.test.ts` (recognition, selection order + missing
capture, verbatim reproduction, unbreakable fence, insufficient_context, failed, oversize
warning) including a **batch-level integration through the real `runShapeSpecGenerationBatch`
with THROWING resolver and LLM mocks** — proving the carriage story completes with zero LLM /
resolver touches. Full shape-spec sweep: 25 suites / 178 tests green; `tsc --noEmit` clean.

Judgment call: pass-2 (cross-story) re-processing of a carriage story simply re-runs the same
deterministic build — idempotent and free, so no special pass gating was added.
