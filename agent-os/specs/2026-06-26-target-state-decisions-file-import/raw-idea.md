Feature: Decisions-file import / template-completion — upload a text file of the user's FINAL target-state decisions to pre-complete the architect conversation. Spec 3 of a 3-spec initiative. DEPENDS ON Spec 1 (`2026-06-26-target-conversation-versioned-answer-bare-stem-ux`, which defines the resolved-label answer/template FORMAT) and SHARES the apply-answers engine with Spec 2 (`2026-06-26-target-dependency-manifest-auto-answer-comprehensive`). STOP at the shaped spec (shape→build pause).

== WHY ==
A user may have run target-state conversations before (this project or another) and have a text file of all the final decisions. They want to edit choices for an existing project, or hand-author/modify a text template in Notepad and upload it to complete the conversation immediately — instead of walking all 51 questions by hand.

== THE FLOW ==
1. Upload the decisions text file (a small upload box labelled "Manually Answer Target State", placed just ABOVE the "Target Dependencies Manifest" upload box).
2. The service parses all the choices in the file.
3. If NO parse errors AND all 51 answered (plus any extra Tier-2 details) → the conversation IMMEDIATELY summarises all the choices and offers "Save Conversation" (the existing conversation CLOSE that writes target-tech-stack-<id>.md).
4. If a PARSE ERROR → highlight the offending line(s) + reason (NO silent drop); the user fixes and reloads.
5. If the file answers only a SUBSET → summarise the answered subset ("here are your choices for 49 questions: [detail]") and proceed to ask the remaining questions in the normal conversation flow.

== KEY DESIGN ==
- ROUND-TRIP FORMAT: the template the user edits is the SAME text the "Preview prompt-ready output" emits (Spec 1's resolved-label format) — so a user can export → tweak in Notepad → re-import. Deterministic parse of a defined template (e.g. `code: resolved-label` lines like `service.framework: Spring Boot 4.0`, `db.driver: pgjdbc 42.7.4`); an optional LLM fallback ONLY for loose/free-form files.
- VALIDATION (no silent drop): per-line, against `questionLibrary` — each line must resolve to a valid decision code + a valid choice (single-choice) or a valid `{framework, version}` (versioned). Line-level error reporting (mirror the manifest's `droppedManifests[]` no-silent-drop pattern). 
- PRE-FILL: write captured-decision rows for the answered codes via the EXISTING envelope/writer, with a NEW `createdByTask` (e.g. `'decisions-file-import'`) so they're discriminable + carry provenance; the conversation continues for the unanswered codes.
- SHARED ENGINE: reuse Spec 2's "apply-answer-set → validate against questionLibrary → summarise → ask-remainder" engine (both the manifest auto-answer and this import are "pre-fill the conversation from a file").
- CROSS-PROJECT REUSE: the file is project-agnostic (answers to the 51); importing into a different project / target architecture is natural. Tier-gating caveat: some questions may be auto-skipped for THIS project's tiers — decide how the import handles file answers to skipped questions.
- MUTUAL EXCLUSIVITY (this spec implements it on BOTH boxes): the decisions-file upload and the Target Dependencies Manifest upload are mutually exclusive bulk inputs — upload one → the OTHER's button disables with a hover-tooltip explaining why; clearing the uploaded file re-enables the other.
- FULL vs SUBSET branch as above (full → summarise + Save/close; subset → summarise answered + continue).

== DEPENDS ON ==
- Spec 1: the resolved-label format (the round-trip template) + bare-stem `{framework, version}` answers + the "Preview prompt-ready output" being the canonical export.
- Spec 2: the apply-answers engine + the captured-decision write path + (optionally) Tier-2 facts in the template.

== OUT OF SCOPE ==
- The manifest auto-answer itself (Spec 2) and the version-decoupling UX (Spec 1).

== CONSTRAINTS ==
- Gateway tests Jest; frontend Vitest; frontend whole-repo baseline RED → verify in isolation.
- Keep the existing captured-decision envelope + POST `/capture` path (no new AMS DTO).

== OPEN QUESTIONS FOR SHAPING ==
1. Exact template/line syntax of the round-trip format (confirm it equals Spec 1's "Preview prompt-ready output"); does the template include Tier-2 facts + scope/exception rows, or just the 51 answers?
2. Deterministic-only parse vs an optional LLM fallback for loose/free-form files — include the fallback now or defer?
3. PRECEDENCE: does an imported file supersede MANUAL in-conversation answers too (the user authored the file → authoritative), or only the automated ones (manifest/prefill)? 
4. The "Save Conversation" path when all 51 answered — reuse the existing conversation-close exactly?
5. Mutual-exclusivity exact tooltip wording + reversibility (clear file → re-enable the other box).
6. Cross-project import: how to handle file answers to questions that are tier-auto-skipped for the current project (ignore with a note? surface as skipped?).
7. Validation error UX: line-level highlight; all-or-nothing vs partial-accept of a file with some bad lines.

Do NOT proceed to write-spec/build — stop at the shaped spec for review.
