# Clarifying Questions: User Journey Overview Diagram Enhancements

Based on your idea for the User Journey Overview Diagram Enhancements (auto-derive relationships, summary sentence, related colleagues navigation), I have some clarifying questions. I have researched the relevant codebase extensively and have context-specific questions.

---

## Enhancement 1: Auto-derive Business Point Relationships from Activity Steps

1. **Placement in the save pipeline.** I see the `userJourneysService.ts` save pipeline currently saves user_journeys, activity_steps, and user_journey_links (via GET-merge-PUT) but does NOT create any business_points or business_user_business_points / application_point_business_points relationships. The existing `usersInteractionsService.ts` does create business_points and business_user_business_points for business_processes (using `bpt_{bpId}` as the business_point ID). I assume we should add the auto-derivation logic at the end of the merge phase in `userJourneysService.ts` (after step 7 merge, before step 8 abbreviations), following the same ID conventions (`bpt_{bpId}` for BUSINESS_PROCESS kind, and a new convention for PROCESS_ACTIVITY kind). Is that correct?

2. **BusinessPoint creation for Process Activities.** The existing `usersInteractionsService.ts` creates BusinessPoints only for business_processes (kind=BUSINESS_PROCESS). For this enhancement, we need to also create BusinessPoints for process_activities (kind=PROCESS_ACTIVITY). I assume the ID convention for a PROCESS_ACTIVITY BusinessPoint should be `bpt_{processActivityId}` (mirroring the BUSINESS_PROCESS pattern of `bpt_{businessProcessId}`). Is that correct, or do you want a different prefix/convention?

3. **ApplicationPoint lookup for the App <-> Business Point relationships.** Each activity step references an `application_id`. The `ApplicationPointBusinessPoint` relationship requires an `application_point_id` (not an `application_id`). I see that `ApplicationPoint` entities have an `application_id` field and a `kind` field (APPLICATION, APP_COMPONENT, SERVICE, etc.). I assume for this feature we should look up the APPLICATION-kind ApplicationPoint whose `application_id` matches the activity step's application_id. If no such ApplicationPoint exists, should we auto-create one (matching the derived ApplicationPoint pattern), or skip the relationship for that step?

4. **Deduplication scope.** I assume deduplication should be global across the entire model's relationship arrays (not just within the current save batch). So if a `business_user_business_points` row with (user_id=X, business_point_id=Y) already exists in the model, we skip creating it. Same for `application_point_business_points`. Is that correct?

5. **Idempotency on re-save.** When the same user journeys are saved again (updated, not created), the derived relationships should be regenerated but not duplicated. I assume we should follow the same upsert pattern: check if a relationship with the same composite key already exists and skip/update rather than append. Is that the expectation?

---

## Enhancement 2: Summary Sentence on Overview Diagram

6. **Summary sentence placement and data source.** The proposed sentence is: "A [User name] is involved in [A] User Journeys across [B] Business Processes, [C] Activity Steps and [D] Applications". I assume:
   - A = count of nodes in the overview (all journeys for this business user)
   - B = count of lanes (unique business processes, excluding the "Unassigned" lane)
   - C = sum of all step_count values across all nodes in this overview
   - D = count of unique applications across ALL activity steps for this user's journeys (not per-journey)
   Is that correct? Should we include the Unassigned lane in the B count?

7. **Where should the summary sentence be computed?** I see two options: (a) compute it in the Java backend `UserJourneyOverviewDiagramProjectionService` and add a `summary_sentence` field to the `UserJourneyOverviewHeaderDto`, or (b) compute it in the frontend renderer from the existing DTO data (nodes, lanes, metadata). I'm leaning toward (a) backend because the unique application count across all journeys requires traversing all activity steps, which the backend projection service already does. Is backend the right place, or should we just derive it on the frontend from the enriched overview data?

8. **Visual rendering of the summary sentence.** I assume this should be a single line of text rendered below the title and above the first lane/column header, using a smaller font than the title (perhaps NODE_DESC_FONT_SIZE=11 or slightly larger). Should it match the title font style but smaller, or should it be a different color/style (e.g., gray italic)?

---

## Enhancement 3: Related Colleagues Navigation

9. **Definition of "related colleague".** You described a related colleague as a user role that shares a Business Process or Process Activity with the current user role, via `business_user_business_points` relationships. I assume the logic is: find all business_point_ids linked to the current business_user_id, then find all OTHER business_user_ids linked to any of those same business_point_ids. The displayed names would be the business_user.name values. Is that the correct interpretation?

10. **Clickable navigation vs. plain text.** Should the related colleague names be clickable links that navigate to that colleague's overview diagram (i.e., calling the same `/temporary?businessUserId=X` endpoint with the colleague's ID and replacing the current overview)? Or should they be plain text labels for informational purposes only? If clickable, should clicking a colleague name cause a full diagram switch within the same canvas view?

11. **Where should the "related colleagues" line be rendered?** You mentioned "at the top of the overview diagram". I assume this means above the title, or between the title and the summary sentence. Which placement do you prefer: (a) above the title, (b) between title and summary sentence, or (c) between summary sentence and the lane headers?

12. **Data source for related colleagues.** Since this requires querying `business_user_business_points` relationships, should this be: (a) computed in the Java backend projection service and included in the DTO as a new field (e.g., `related_colleagues: [{id, name}]` on the header), or (b) computed on the frontend by traversing the model's relationship data? Backend seems cleaner since the projection service already has DB access. Is that correct?

13. **Edge case: no related colleagues.** If the current user role has no shared Business Points with any other user role, should the "Related Colleagues" line be hidden entirely, or should it show something like "No related colleagues found"?

---

## General / Scope

14. **Is there anything explicitly out of scope?** For example: should we NOT change the existing `save_users_interactions` pipeline (even though it already creates some business_points), and only add the derivation to `save_user_journeys`? Should we NOT modify the existing overview diagram save/sync flow? Should we NOT add any new API endpoints beyond extending the existing projection service?

---

**Existing Code Reuse:**
Are there existing features in your codebase with similar patterns we should reference? For example:
- The `usersInteractionsService.ts` BusinessPoint creation pattern (lines 228-263) as a model for the new derivation logic
- The `UserJourneyOverviewDiagramProjectionService.java` for extending the DTO contract
- The `UserJourneyOverviewDiagramRenderer.tsx` layout computation for adding new visual elements
- Any other similar derived-relationship creation or overview enrichment patterns

Please provide file/folder paths or names of these features if there are additional ones I should examine.

**Visual Assets Request:**
Do you have any design mockups, wireframes, or screenshots that could help guide the development?

If yes, please place them in: `agent-os/specs/2026-04-10-user-journey-overview-enhancements/planning/visuals/`

Use descriptive file names like:
- overview-with-summary-mockup.png
- related-colleagues-wireframe.png
- current-overview-screenshot.png

Please answer the questions above and let me know if you've added any visual files or can point to similar existing features.
