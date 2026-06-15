name: user-journey-temporary-diagram-selection-and-review-flow
summary: Add the UI and orchestration flow that lets a user review multiple generated temporary User Journey diagrams one at a time after the UX Designer save step, choose which journey to inspect, load its temporary diagram into the existing diagram canvas context, and move through the set journey-by-journey.

motivation:
- Increment 5 generates deterministic temporary diagram JSON for each persisted USER_JOURNEY, but there is no user-facing way to choose among multiple journeys and inspect them.
- The UX Designer workflow needs a practical review loop: user finishes spreadsheet + clarification + save → system generates temporary diagrams for all journeys → user selects one journey → user sees the generated diagram → user later edits/saves it in subsequent increments.
- This increment introduces the selection/review mechanics, but does not yet persist edited diagrams as real diagram artifacts.

scope:
- Add a temporary User Journey diagram review flow integrated with the UX Designer conversation result.
- Surface the list of generated journeys/temporary diagrams to the user.
- Allow selecting a journey from the generated set.
- Load the selected journey's temporary diagram into the existing diagram viewing/canvas experience in a review-only manner.
- Allow moving to the next/previous generated journey without re-running the UX Designer flow.
- No permanent diagram save in this increment.
- No native User Journey diagram type registration in the diagram type picker yet.
- No editing interactions beyond review/load behavior.

out_of_scope:
- Persisting temporary diagrams as saved diagrams.
- Editing and saving User Journey diagrams.
- Changes to spreadsheet import or save pipeline.
- Full native renderer/editor implementation for User Journey diagram type.
- Changes to other persona flows.
- Bulk review dashboard.

architectural_intent:
- Temporary User Journey diagrams are generated from authoritative meta-model data and remain ephemeral.
- The selection/review flow should feel like a continuation of the UX Designer task outcome.
- Must clearly distinguish between temporary/generated diagram and saved/persistent diagram artifact.

user_experience:
1. User runs @UX Designer → "Define User Journeys"
2. Spreadsheet interpreted, clarified, saved
3. System generates temporary diagrams for all persisted USER_JOURNEY records
4. Assistant presents review prompt
5. UI presents journey chooser
6. User selects a journey
7. Temporary diagram opens in diagram viewing/canvas area
8. User can inspect, switch, navigate next/previous, close review mode
9. Diagram clearly marked as temporary/generated

ui_intent:
- Reuse existing conversation + diagram workspace patterns
- Add lightweight temporary review mechanism
- User should not manually copy/paste IDs or use raw JSON
- Must work with multiple journeys

recommended_ui_shape:
- Compact "Generated User Journeys" chooser UI (modal, side panel, or inline card)
- Displays: journey name, primary role, parent business process, step count
- Actions: Review, Next, Previous, Close
- Selected journey loads temporary diagram into diagram workspace/canvas

state_model:
- Ephemeral frontend state for "temporary user journey review session"
- Contains: sourceTask, projectId, generatedJourneys array, selectedJourneyId, selectedDiagramJson, isTemporary flag, status
- Frontend/session scoped only, not persisted to backend

data_loading:
- After save, call GET /api/projects/{projectId}/user-journey-diagrams/temporary (Increment 5 endpoint)
- Build chooser from returned contracts
- On selection, use already-fetched data or fetch single journey

integration:
- Gateway/frontend orchestration after save: fetch diagrams → populate review state → present chooser
- Single journey auto-opens without chooser
- Assistant message aligns with UI state

diagram_loading:
- Temporary diagram JSON must load into canvas pipeline without being saved
- May need temporary diagram adapter/bridge
- Clear "Temporary Generated Diagram" label

navigation:
- Open, next, previous, return to list, close review mode
- Deterministic ordering

failure_handling:
- Empty state message if no diagrams
- Error per-journey if one fails to load
- Clean state cleanup on close

acceptance_criteria:
1. After save, system fetches generated temporary diagrams
2. Multiple journeys → chooser shown
3. Chooser shows name, role, process, step count
4. Selection loads temporary diagram into canvas
5. Diagram labeled as temporary
6. Single journey auto-loads
7. Next/previous navigation works
8. Return to chooser from diagram
9. Close clears state
10. Not persisted as saved artifact
11. Existing saved diagram workflows unchanged
12. Existing non-UX Designer flows unchanged

testing:
- Frontend: chooser rendering, auto-load, selection, navigation, close, temporary label
- Integration: save triggers fetch, diagrams open without persistence
- Regression: existing diagram and persona flows unaffected
