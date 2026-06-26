# Specification: Target-State Conversation — Save, Resume, and Plan Sourcing Decoupled from "Active"

## Goal
Make a target-state architect conversation a saveable, resumable, listable object and source the Migration Delivery Plan from the most-recent-saved conversation (decoupled from the "active" target architecture), adding a pre-flight readiness check so incomplete work is flagged in the plan wizard before generation rather than as spurious post-generation LLM "missing inputs."

## User Stories
- As an architect, I want to save a target-state conversation and return to it later (view its transcript + decisions/tech-stack, then reopen and continue), so my work persists independently of promoting a draft to "active."
- As a Product Manager, I want the plan wizard to source from a chosen saved conversation (default most-recent-saved) and show its readiness before generation, so the plan reads the decisions/tech-stack/mappings I actually authored.

## Specific Requirements

**FR1 — Save marker column (AMS)**
- Add nullable `conversation_saved_at` (TIMESTAMPTZ NULL) to the `architecture` table via a NEW Liquibase changeset `203-architecture-conversation-saved-at.sql`, registered in `db.changelog-master.yaml` AFTER `202` with the not-columnExists precondition idiom (onFail MARK_RAN), mirroring `198`/`201`/`202`.
- Mirror on `ArchitectureEntity.java` as a nullable boxed `Instant conversationSavedAt` `@Column(name = "conversation_saved_at")`, modelled exactly on `lastMarkedStaleAt` (`ArchitectureEntity.java:131`) — never primitive, so null-safe PATCH preserves the column.
- No backfill (existing rows stay null = "never saved"); applies to `kind='target'` rows in practice but the column is unconditional.
- Defer `conversation_status` entirely — the timestamp drives every query.
- Add a focused changeset test mirroring the existing AMS changeset-test convention (TIMESTAMPTZ → H2 alias).

**FR2 — Stamp endpoint + finders (AMS)**
- Add a stamp endpoint that sets `conversation_saved_at = now()` for a given target architecture (e.g. `POST /api/projects/{projectId}/target-architectures/{targetArchitectureId}/conversation-saved`), returning the stamped instant; sibling-placed to `ActiveTargetArchitectureController`.
- Add repository finder most-recent-saved: `findFirstByProjectIdAndKindAndArchivedFalseAndConversationSavedAtIsNotNullOrderByConversationSavedAtDesc` (LIMIT 1), modelled on `findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc` (`ActiveTargetArchitectureController.java:74-80`).
- Add repository finder list-saved: same predicate, no limit (`findByProjectIdAndKindAndArchivedFalseAndConversationSavedAtIsNotNullOrderByConversationSavedAtDesc`).
- Expose a most-recent-saved id endpoint mirroring `GET .../active-target-architecture-id` (camelCase wire via `@CamelCaseWire`), returning `{ savedTargetArchitectureId: <uuid>|null }`, for the gateway resolver default.
- Surface `conversationSavedAt` on `ArchitectureDto` + the mapper so the existing `listTargets` (`TargetArchitecturePromoteService.java:309-363`) carries the saved indicator/timestamp; the list-saved finder backs the wizard's saved-conversation picker.

**FR3 — Save action: stamp + relabel (gateway + frontend)**
- The architect-conversation close handler (`architectConversation.ts:836-904`) additionally calls the new stamp endpoint AFTER `appendTurn(CloseTurn)` + `writeTargetTechStackMarkdown` (`:867-896`); add a thin client function in `targetStateCapturedDecisionsClient.ts` for the stamp call.
- Stamp failure is fail-soft and additive — surfaced on the close payload (alongside `targetTechStackWrite`) without aborting the close turn, matching the tech-stack-write fail-soft pattern.
- Keep the existing close gate unchanged: `CLOSE_GATE_CODES` = `service.language` + `api.protocol` + `db.engine` (`CloseConversationFlow.tsx:38-77`) remains the MINIMUM to enable Save; `db.migrations` stays OUT of the gate.
- Relabel the close CTA to "Save Conversation"; when the gate is met but other decisions are incomplete, show a non-blocking completeness summary + warning and still allow Save (no hard block beyond the existing gate).

**FR4 — Plan sourcing decoupled from active (gateway)**
- Replace `fetchActiveTargetArchitectureId` at `contextResolvers.ts:820` (`TargetStateDecisionsContextResolver`) AND `:1100` (`TargetTechStackContextResolver`) with a most-recent-saved resolver (new client fn over the FR2 saved-id endpoint); preserve the existing two-state fallbacks ("no target architecture defined yet" / file-absent sentinel).
- Redirect the `target-tech-stack-<id>.md` filename id (`contextResolvers.ts:1156`) to the SAME resolved (saved) target so decisions + tech-stack bind to one target and cannot diverge.
- Keep passing the additive `tier2Facts` arg into `buildTargetStateDecisionsPromptText` (`contextResolvers.ts:867-868,937-940`) — fetched against the resolved saved target, not the active one.
- Unify decisions + tech-stack + mappings on the one resolved target; update the resolver `[diag-gw]` log reasons to reflect saved-target resolution (e.g. `no_saved_conversation`).

**FR5 — Plan-target binding (frontend wizard)**
- The wizard's Target architecture `<select>` (`MigrationDeliveryPlanWizard.tsx:732-747`) becomes "pick a saved conversation": options filtered to saved targets (`conversationSavedAt != null`), labelled with name + saved date, defaulting `targetArchitectureId` to the most-recent-saved.
- The single choice drives decisions + tech-stack + mappings together (the same id flows into the context fetch + downstream stages); allow choosing any other saved conversation from the list.
- Current architecture selector is unchanged.

**FR6 — Saved-conversations list + resume (frontend)**
- Extend the existing target-architectures list (`TargetArchitectureWorkspace.tsx`) with a saved-conversation indicator/filter driven by `conversationSavedAt` from `ArchitectureDto` (FR2) — not a new parallel section.
- Conversation sub-tab landing: when the selected draft is a saved conversation, `ArchitectConversationTab.tsx:1199-1231` lands view-only (existing `isResumingPrior` transcript pane via `ConversationMainPane`) on the saved conversation INSTEAD of defaulting to a fresh start.
- Opening a saved conversation shows a view-only transcript + decisions/tech-stack with an explicit "Reopen / continue" CTA that resumes the question walk (the existing start path); keep "Start new conversation" as a distinct secondary action.

**FR7 — Pre-flight readiness panel (frontend wizard)**
- Add an inline, non-blocking readiness panel in stage 1 "Inputs & context" (`renderStage1`, `MigrationDeliveryPlanWizard.tsx:703+`, near the existing `mdp-wizard-readiness-card`) for the chosen saved conversation.
- Panel shows: saved date · decisions answered/total (EXCLUDING `not_applicable`/`deferred` from BOTH numerator and denominator — auto-skipped, not gaps) · foundational DB decisions present (`db.engine` / `db.migrations`) · tech-stack written (y/n) · named gaps.
- Use the tolerant reader `resolveCapturedAnswerLabel` (`architectConversationApi.ts:160-182`) for the non-uniform `answerValue` envelope (versioned `{value:{framework,version}}`, bare string, wrapped `{value:<string>}`, `string[]`, `not_applicable`/`deferred`); prefer `answerSummary` for labels. Do NOT write a new parser.
- Non-blocking: the wizard still proceeds; the panel pre-empts the LLM "missing inputs" by naming the gaps up front.

## Existing Code to Leverage

**`ActiveTargetArchitectureController.java:74-80` + repository active-target finder**
- The active-target controller + `findFirstByProjectIdAndKind...OrderByCreatedAtDesc` is the sibling to clone for the FR2 stamp endpoint, most-recent-saved id endpoint, and both new finders (order by `conversation_saved_at DESC`). Reuse the `@CamelCaseWire` response-record idiom.

**`ArchitectureEntity.java:131` (`lastMarkedStaleAt`)**
- Net-new `conversationSavedAt` mirrors this nullable boxed-`Instant` column exactly; copy the null-safe-PATCH rationale. Liquibase `198-architecture-proceed-critical-override.sql` is the changeset template (ALTER TABLE architecture ADD COLUMN ... NULL, no backfill, not-columnExists precondition).

**`contextResolvers.ts:816-874` + `:1085-1181` (the two resolvers) and `buildTargetStateDecisionsPromptText:937`**
- Both resolvers already share the `fetchActiveTargetArchitectureId` → fail-soft-fallback shape; swap the lookup only, keep the fallbacks, sentinels, `tier2Facts` plumbing, and `target-tech-stack-<id>.md` filename composition (`:1156`) consistent with the resolved id.

**`architectConversation.ts:867-896` close handler + `targetStateCapturedDecisionsClient.ts`**
- Close handler already does append-CloseTurn + write-tech-stack with fail-soft typed outcomes; ADD the stamp call in the same try and report it additively. The captured-decisions client is the home for the new stamp + saved-id client functions (mirror `fetchActiveTargetArchitectureId`).

**`resolveCapturedAnswerLabel` (`architectConversationApi.ts:160-182`)**
- Already tolerates all 5 `answerValue` shapes and never throws; reuse verbatim for FR7 readiness counting/labelling. `CLOSE_GATE_CODES` (`CloseConversationFlow.tsx:38`) is reused for the save gate; the existing `isResumingPrior` view-only transcript pane (`ArchitectConversationTab.tsx:1200-1231`) is reused for resume.

## Out of Scope
- Auto-answering `db.engine` / `db.migrations` (covered by the shipped manifest auto-answer + decisions-file import).
- A dedicated conversation entity / multiple distinct saved conversations PER target architecture (one saved marker per target arch suffices).
- Changing the `thread.json` transcript storage (`targetStateConversationStore.ts`).
- The `conversation_status` column (deferred; timestamp-only drives every query).
- The book-of-work scaffold story / manifest→Service FK (other specs).
</content>
</invoke>
