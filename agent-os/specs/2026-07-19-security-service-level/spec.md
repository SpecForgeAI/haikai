# Security health dashboard — service-level association + display config (3 specs)

Date: 2026-07-19 (second build wave, follow-on to 2026-07-19-security-health-dashboard).
Branch: `feature/security-service-level` off main (b82f16a). One commit per spec.
Mode: Fable 5 direct implementation, agent-os artifact trail retained.

## Requirements (user, 2026-07-19 evening)

1. Association beyond application: down the Application -> Application Component -> Service
   hierarchy (Service carries repo_location; service<->repo assumed 1:1 for now).
2. Wizard display configuration: the user picks which hierarchy levels the Security Summary
   shows and how they nest — e.g. App -> Comp -> Service embedded, App -> Service, or
   Service-only flat. Config lives ON THE DIAGRAM (settings json) and is changeable via
   Regenerate without re-uploading (user decision 3).
3. Overview interactivity: drag-to-move boxes directly on the Overview (persisted through the
   normal diagram save); adding/creating content (e.g. data movements) STAYS in the Diagrams
   area (user decision 1). Register gains component/service filters (user decision 2).

## Design rules

- **Nearest-displayed-ancestor circles**: each finding's severity counts attach to the closest
  displayed ancestor of its attributed entity, so any display subset works against any
  association level. AMS returns counts keyed by the finding's own (level, entity_id); the
  FRONTEND aggregates via the metaModel ancestry it already holds — changing display nesting
  never needs a server call.
- **Regenerate preserves user additions**: decorations and non-derived nodes/edges survive;
  DATA_MOVEMENT edges always re-derive from the model (movements added via the Diagrams area
  edit the model, so they become derived and survive by construction).
- **Attribution generalizes, never breaks**: findings gain `entity_id` (changeset 213, backfilled
  from application_id); `application_id` stays populated for application-level rows (deprecated
  read path); the rollup keeps its `applications` field for app-level reports while adding the
  generic `entities` list, so the live Overview keeps working between Spec A and Spec C.

## Specs

A. **AMS**: changeset 213 (entity_id + backfill + index), ingestion entityId (applicationId
   fallback), level-generic rollup entities list, ancestor-aware register filtering
   (application_id expands to descendant components+services; new application_component_id /
   service_id params), new register columns (entity_id/entity_name/application_component_name/
   service_name/service_repo_location; application_* become ancestor-aware), tests.
B. **Gateway + wizard**: resolutions carry entity_id; component/service levels enabled;
   per-level value matching (services by name AND normalized repo URL — pulls the repo-URL
   normalizer forward); parent-context picker labels; display-levels chooser; prefill.
C. **Diagram + Overview**: nested generation from display_levels (parent_node_id containment,
   deterministic child-grid layout, position-preserving regenerate that keeps user additions),
   edges rolled to nearest displayed level, circle aggregation client-side, drag-to-move on the
   Overview SVG, Regenerate dialog with display-levels chooser, register component/service
   filter dropdowns + new columns.

## Deferred (unchanged from wave 1)

Service<->repo N:1 modeling; finding-class split; register-config UI; action plans;
cross-upload diffs; CWE enrichment beyond seed.

## As-built log (2026-07-19 late evening, autonomous run)

All 3 specs BUILT and committed on `feature/security-service-level`
(Spec A 33510f0, Spec B 4eb494f, Spec C follows). Not merged — user review pending.

Verification: AMS 13 H2 tests green (incl. new service-level attribution/ancestry/filter
coverage) + a real-Postgres-16 bind-shape IT (throwaway docker, prod dialect, full Liquibase
incl. 213 backfill) for the new sentinel/IN-list/rollup query shapes — scratch IT removed
after the run (requires a local container; the H2Dialect-masking lesson from the register-500
fix is why real-Postgres verification is now part of the loop). Gateway 13 jest green.
Frontend 59 vitest green across the security + diagram-type suites; tsc clean on touched files.

Notable implementation facts:
- Drag-to-move on the Overview is OUTERMOST boxes only (children re-lay inside on
  regenerate); full editing incl. resize/palette stays in the Diagrams area per user decision.
- The wizard's display-levels chooser lives in the level step; the same chooser appears in
  the Overview's Regenerate dialog; config persists in diagram settings
  (`security_display_levels`), chain-ordered, non-empty enforced.
- Rollup keeps the pre-213 `applications` wire field for application-level reports; the
  Overview accepts it as a fallback, so mixed-version FE/AMS deployments degrade gracefully.
- Alias memory is level-scoped end-to-end; manual picks teach back at the upload's level.
- Service matching includes normalized repo-URL collision (https/ssh/bare, .git, case).

Live-shakedown residuals (work machine): service-level upload against a real GitLab export
(Full Path/repo-path linking), nested diagram open/edit in the Diagrams area (containment
rendering of SECURITY_SUMMARY via the General canvas with parent_node_id set by generation),
drag persistence round-trip, and the Regenerate chooser against a user-edited diagram.
