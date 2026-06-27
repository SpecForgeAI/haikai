# Spec B — Version-unknown manifest entries become pending questions (design A)

When a target dependency manifest (pom.xml / package.json) is uploaded for the architect conversation, the gateway auto-answers framework/library/build-tool/driver decisions. Today, if a library is present but its VERSION cannot be resolved from the manifest, the gateway STILL writes a fully-captured decision row with the sentinel value `version-unknown`. This is wrong: a version-unknown answer is NOT a fully captured decision, yet it:
- shows in the "Decisions Captured" panel as "<library> (version unknown)",
- counts as "answered" so the question sequencer never asks for the missing version,
- flows into the prompt-ready output and the close-gate as if complete.

## Desired behaviour (design A — chosen by the user)
Version-unknown manifest results must become the FIRST questions the architect is asked, with the library/framework PRE-CHOSEN (from the manifest), so the user simply confirms the version quickly. Until a version is confirmed:
- do NOT write a captured-decision row for that coordinate,
- do NOT show it in "Decisions Captured",
- do NOT include it in prompt-ready output or the close-gate "answered" count.
Only once the user confirms the exact version is the captured-decision row written (the normal capture path).

Concrete-version auto-answers from the manifest are UNCHANGED — they still auto-answer and capture as today. This change is specific to the version-unknown case.

## Current implementation (grounding — to be confirmed during shaping)
- Sentinel `VERSION_UNKNOWN = 'version-unknown'` (`gateway/src/config/architect-conversation/frameworkVersionShape.ts:57`).
- Unresolved coordinates degrade to the sentinel in `gateway/src/services/targetManifest/manifestVersionResolution.ts`.
- The row is written during upload by `runManifestAutoAnswer` in `gateway/src/services/targetManifest/manifestAutoAnswerer.ts` (~336-431), via `postCapturedDecision`, with `createdByTask = 'target-manifest-auto-answer'`.
- The question sequencer (`gateway/src/services/architectConversation/questionSequencer.ts:76-84`) skips ANY code that has a captured-decision row — it never inspects the value. `answeredCodes` is built purely from row presence (`gateway/src/routes/architectConversation.ts:578`).
- There is currently NO data-model concept of "incomplete / pending confirmation" vs "fully captured" anywhere in the gateway or AMS captured-decisions store.
- The versioned decision codes use a structured { framework, version } capture envelope; the frontend `VersionedAnswerControl` already supports a pre-chosen framework stem with a version field (`frontend/src/components/targetState/architectConversation/ConversationMainPane.tsx` + `versionControlConfig.ts`).
- The manifest upload panel already renders version-unknown as an editable affordance (`ManifestUploadPanel.tsx` AutoAnsweredDecision) — but separately from the conversation question walk.

## Scope notes
- Gateway + frontend. No AMS schema change is desired if avoidable; prefer carrying "pending version confirmations" as conversation/thread state rather than inventing a persisted captured-decision status field (design A = don't persist until confirmed).
- This is SEPARATE from Spec A (right-panel UX) and Spec C (live vulnerability-reduction recompute + OSV bridge + logging).
- Spec C will later source target versions from the conversation's captured versioned answers — so getting version confirmation to flow through the normal capture path here benefits C.
