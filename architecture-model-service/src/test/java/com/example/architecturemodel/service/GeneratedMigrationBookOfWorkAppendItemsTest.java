package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.AppendGeneratedMigrationBookOfWorkItemsRequest;
import com.example.architecturemodel.model.dto.GeneratedMigrationBookOfWorkDto;
import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkEntity;
import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkStatus;
import com.example.architecturemodel.repository.entity.GeneratedMigrationBookOfWorkRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Service-layer tests for the phase-2 {@code items/append} server-side merge
 * ({@link GeneratedMigrationBookOfWorkService#appendItems(UUID, UUID,
 * AppendGeneratedMigrationBookOfWorkItemsRequest)}).
 *
 * <p>Same {@code @DataJpaTest} + H2 JSONB-domain-aliased harness as
 * {@link GeneratedMigrationBookOfWorkServiceTest}.</p>
 *
 * <p>Test plan (Task Group 2, sub-task 2.1 — focused, no exhaustive
 * malformed-payload permutations):</p>
 * <ol>
 *   <li>A valid append merges the new story items under the target epic AND
 *       updates that epic's {@code expansionState} inside
 *       {@code book_of_work_json}, leaving all other epics' items and states
 *       intact.</li>
 *   <li>Two sequential appends for DIFFERENT epics both survive — the merge
 *       is server-side against the current stored JSON, never a client
 *       read-modify-write, so neither append loses the other's write.</li>
 *   <li>Append targeting an unknown epic id rejects with
 *       {@code IllegalArgumentException} (controller maps to 400).</li>
 *   <li>Append to a non-draft book rejects with
 *       {@code IllegalArgumentException} (controller maps to 400).</li>
 *   <li>A STATE-ONLY merge (no items) updates the epic's expansion state
 *       without touching the item list — the gateway's
 *       {@code expanding} / {@code failed} transition path.</li>
 * </ol>
 *
 * <p>Spec: Two-Phase Migration Delivery Plan Generation (Skeleton -&gt;
 * Expand) (2026-06-11) -- Task Group 2. NO Liquibase change — expansion state
 * rides inside {@code book_of_work_json}.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:gmbwappenddb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
@Import({
    GeneratedMigrationBookOfWorkService.class,
    GeneratedMigrationBookOfWorkService.GeneratedMigrationBookOfWorkItemSaver.class
})
class GeneratedMigrationBookOfWorkAppendItemsTest {

    @Autowired
    private GeneratedMigrationBookOfWorkService service;

    @Autowired
    private GeneratedMigrationBookOfWorkRepository repository;

    @Autowired
    private TestEntityManager entityManager;

    /**
     * Skeleton fixture mirroring a phase-1 draft: one initiative with TWO
     * epics (both seeded {@code expansionState='not_expanded'}), one of which
     * already carries a feature. Item ids use the {@code <stream>:<id>}
     * namespacing convention from the gateway's per-stream assembly.
     */
    private static GeneratedMigrationBookOfWorkDto buildSkeletonCreateRequest() {
        Map<String, Object> bookOfWork = new LinkedHashMap<>();
        bookOfWork.put("items", List.of(
            Map.of("id", "api:I1", "type", "initiative", "title", "Migrate services"),
            Map.of("id", "api:E1", "type", "epic", "parentId", "api:I1",
                "title", "Customer endpoints", "expansionState", "not_expanded"),
            Map.of("id", "api:E2", "type", "epic", "parentId", "api:I1",
                "title", "Pricing endpoints", "expansionState", "not_expanded"),
            Map.of("id", "api:F1", "type", "feature", "parentId", "api:E1",
                "title", "GET /customers/{id}")
        ));
        return new GeneratedMigrationBookOfWorkDto(
            null, null,
            UUID.randomUUID(), UUID.randomUUID(),
            null,
            "Skeleton draft",
            "Phase-1 skeleton awaiting expansion.",
            null, null, null,
            bookOfWork,
            null, null, null, null, null
        );
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> itemsOf(Map<String, Object> bookOfWorkJson) {
        return (List<Map<String, Object>>) bookOfWorkJson.get("items");
    }

    private static Map<String, Object> itemById(List<Map<String, Object>> items, String id) {
        return items.stream()
            .filter(it -> id.equals(it.get("id")))
            .findFirst()
            .orElse(null);
    }

    @Test
    @DisplayName("valid append merges stories under the target epic + updates its expansionState; other epics untouched")
    void validAppendMergesItemsAndState() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft =
            service.createDraft(projectId, buildSkeletonCreateRequest());

        AppendGeneratedMigrationBookOfWorkItemsRequest request =
            new AppendGeneratedMigrationBookOfWorkItemsRequest(
                "api:E1",
                List.of(
                    // A feature appended in the same batch + a story under it,
                    // plus a story under the PRE-EXISTING feature.
                    Map.of("id", "api:F2", "type", "feature", "parentId", "api:E1",
                        "title", "POST /customers"),
                    Map.of("id", "api:S1", "type", "story", "parentId", "api:F2",
                        "title", "Implement POST /customers",
                        "tags", List.of("stream:api", "provenance:stamped")),
                    Map.of("id", "api:S2", "type", "story", "parentId", "api:F1",
                        "title", "Implement GET /customers/{id}")
                ),
                AppendGeneratedMigrationBookOfWorkItemsRequest.STATE_EXPANDED
            );

        GeneratedMigrationBookOfWorkDto updated =
            service.appendItems(projectId, draft.id(), request);

        List<Map<String, Object>> items = itemsOf(updated.bookOfWorkJson());
        assertThat(items).hasSize(7); // 4 skeleton + 3 appended

        // The appended items are merged with their parent links intact.
        assertThat(itemById(items, "api:S1")).containsEntry("parentId", "api:F2");
        assertThat(itemById(items, "api:S2")).containsEntry("parentId", "api:F1");

        // The target epic's expansion state is updated...
        assertThat(itemById(items, "api:E1")).containsEntry("expansionState", "expanded");
        // ...and the OTHER epic's items + state are untouched.
        assertThat(itemById(items, "api:E2")).containsEntry("expansionState", "not_expanded");
        assertThat(itemById(items, "api:I1")).containsEntry("title", "Migrate services");
    }

    @Test
    @DisplayName("re-expand (replaceEpicExpansion) drops the epic's prior stories + tagged scaffold, keeps skeleton features, no duplicates")
    void reExpandReplacesEpicExpansionOutput() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft =
            service.createDraft(projectId, buildSkeletonCreateRequest());

        // First expand (additive): a tagged scaffold feature + its story, and a
        // story under the skeleton feature api:F1 — all tagged expansionGenerated
        // exactly as the gateway now tags every expansion-produced item.
        service.appendItems(projectId, draft.id(),
            new AppendGeneratedMigrationBookOfWorkItemsRequest(
                "api:E1",
                List.of(
                    Map.of("id", "api:SF", "type", "feature", "parentId", "api:E1",
                        "title", "Scaffold", "expansionGenerated", true),
                    Map.of("id", "api:SFS", "type", "story", "parentId", "api:SF",
                        "title", "Scaffold story", "expansionGenerated", true),
                    Map.of("id", "api:S1", "type", "story", "parentId", "api:F1",
                        "title", "old story", "expansionGenerated", true)),
                AppendGeneratedMigrationBookOfWorkItemsRequest.STATE_EXPANDED,
                null)); // first expand: no prior output to replace

        // Re-expand WITH replace: a fresh story (new id) under the skeleton
        // feature, replace flag on.
        GeneratedMigrationBookOfWorkDto updated = service.appendItems(projectId, draft.id(),
            new AppendGeneratedMigrationBookOfWorkItemsRequest(
                "api:E1",
                List.of(Map.of("id", "api:S2", "type", "story", "parentId", "api:F1",
                    "title", "new story", "expansionGenerated", true)),
                AppendGeneratedMigrationBookOfWorkItemsRequest.STATE_EXPANDED,
                true));

        List<Map<String, Object>> items = itemsOf(updated.bookOfWorkJson());
        // Prior expansion output is GONE: old story + scaffold feature + scaffold story.
        assertThat(itemById(items, "api:S1")).isNull();
        assertThat(itemById(items, "api:SF")).isNull();
        assertThat(itemById(items, "api:SFS")).isNull();
        // Fresh story present, parented to the surviving skeleton feature.
        assertThat(itemById(items, "api:S2")).containsEntry("parentId", "api:F1");
        // Skeleton preserved: initiative, epic (state stamped), skeleton feature.
        assertThat(itemById(items, "api:E1")).containsEntry("expansionState", "expanded");
        assertThat(itemById(items, "api:F1")).isNotNull();
        assertThat(itemById(items, "api:I1")).isNotNull();
        // The OTHER epic untouched.
        assertThat(itemById(items, "api:E2")).containsEntry("expansionState", "not_expanded");
        // No duplicates / no stale leftovers: 4 skeleton + 1 fresh story = 5.
        assertThat(items).hasSize(5);
    }

    @Test
    @DisplayName("re-expand carries over workItemId + saveState for a regenerated SAME-id story (text replaced, identity kept)")
    void reExpandCarriesOverIdentityForRegeneratedIds() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft =
            service.createDraft(projectId, buildSkeletonCreateRequest());
        String workItemId = UUID.randomUUID().toString();
        // First expand: the story is subsequently SAVED to the backlog -- it
        // carries its work item linkage and save state on the blob item.
        service.appendItems(projectId, draft.id(),
            new AppendGeneratedMigrationBookOfWorkItemsRequest(
                "api:E1",
                List.of(Map.of("id", "api:S1", "type", "story", "parentId", "api:F1",
                    "title", "old text", "expansionGenerated", true,
                    "workItemId", workItemId, "saveState", "saved")),
                AppendGeneratedMigrationBookOfWorkItemsRequest.STATE_EXPANDED,
                null));
        // Re-expand under the SAME id with new text and NO identity fields (the
        // planner regenerates content, never identity).
        GeneratedMigrationBookOfWorkDto updated = service.appendItems(projectId, draft.id(),
            new AppendGeneratedMigrationBookOfWorkItemsRequest(
                "api:E1",
                List.of(Map.of("id", "api:S1", "type", "story", "parentId", "api:F1",
                    "title", "new text", "expansionGenerated", true)),
                AppendGeneratedMigrationBookOfWorkItemsRequest.STATE_EXPANDED,
                true));
        List<Map<String, Object>> items = itemsOf(updated.bookOfWorkJson());
        Map<String, Object> story = itemById(items, "api:S1");
        // Text replaced; identity survived -- the work_item row is still linked.
        assertThat(story).containsEntry("title", "new text");
        assertThat(story).containsEntry("workItemId", workItemId);
        assertThat(story).containsEntry("saveState", "saved");
        assertThat(items).hasSize(5); // 4 skeleton + the one regenerated story
    }

    @Test
    @DisplayName("re-expand never fabricates or overwrites identity: new ids get none, caller values win, un-regenerated ids are dropped")
    void reExpandDoesNotFabricateOrOverwriteIdentity() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft =
            service.createDraft(projectId, buildSkeletonCreateRequest());
        String heldA = UUID.randomUUID().toString();
        String heldB = UUID.randomUUID().toString();
        service.appendItems(projectId, draft.id(),
            new AppendGeneratedMigrationBookOfWorkItemsRequest(
                "api:E1",
                List.of(
                    Map.of("id", "api:S1", "type", "story", "parentId", "api:F1",
                        "title", "one", "expansionGenerated", true,
                        "workItemId", heldA, "saveState", "saved"),
                    Map.of("id", "api:S9", "type", "story", "parentId", "api:F1",
                        "title", "nine", "expansionGenerated", true,
                        "workItemId", heldB, "saveState", "saved")),
                AppendGeneratedMigrationBookOfWorkItemsRequest.STATE_EXPANDED,
                null));
        String callerSupplied = UUID.randomUUID().toString();
        GeneratedMigrationBookOfWorkDto updated = service.appendItems(projectId, draft.id(),
            new AppendGeneratedMigrationBookOfWorkItemsRequest(
                "api:E1",
                List.of(
                    // Same id, but the caller supplies its own workItemId: not overwritten.
                    Map.of("id", "api:S1", "type", "story", "parentId", "api:F1",
                        "title", "one again", "expansionGenerated", true,
                        "workItemId", callerSupplied),
                    // Brand-new id: gets NO identity.
                    Map.of("id", "api:S2", "type", "story", "parentId", "api:F1",
                        "title", "two", "expansionGenerated", true)),
                    // api:S9 is NOT regenerated: its held identity is dropped, never
                    // re-attached to another story.
                AppendGeneratedMigrationBookOfWorkItemsRequest.STATE_EXPANDED,
                true));
        List<Map<String, Object>> items = itemsOf(updated.bookOfWorkJson());
        Map<String, Object> s1 = itemById(items, "api:S1");
        assertThat(s1).containsEntry("workItemId", callerSupplied);
        assertThat(s1).containsEntry("saveState", "saved"); // only the missing field is filled
        Map<String, Object> s2 = itemById(items, "api:S2");
        assertThat(s2).doesNotContainKeys("workItemId", "saveState");
        assertThat(itemById(items, "api:S9")).isNull();
        for (Map<String, Object> it : items) {
            assertThat(it.get("workItemId")).isNotEqualTo(heldB);
        }
    }

    @Test
    @DisplayName("re-expand EXEMPTS the out-of-band scaffold seed story (seed_build_files) that expansion cannot regenerate; ordinary stories still replaced")
    void reExpandExemptsSeedBuildFilesScaffoldStory() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft =
            service.createDraft(projectId, buildSkeletonCreateRequest());
        String scaffoldWorkItemId = UUID.randomUUID().toString();
        // The live shape: a scaffold feature with no codeFeatureKind hosting the
        // seed story minted by the scaffold-story endpoint, saved + implemented,
        // plus an ordinary regenerable story. A prior expansion stamped both
        // expansionGenerated:true.
        service.appendItems(projectId, draft.id(),
            new AppendGeneratedMigrationBookOfWorkItemsRequest(
                "api:E1",
                List.of(
                    Map.of("id", "api:SF", "type", "feature", "parentId", "api:E1",
                        "title", "Scaffold", "expansionGenerated", true),
                    Map.of("id", "api:SEED", "type", "story", "parentId", "api:SF",
                        "title", "Scaffold the app and reproduce pom.xml",
                        "expansionGenerated", true,
                        "tags", List.of("seed_build_files", "stream:api_migration",
                            "provenance:scaffold"),
                        "workItemId", scaffoldWorkItemId, "saveState", "saved"),
                    Map.of("id", "api:S1", "type", "story", "parentId", "api:F1",
                        "title", "old story", "expansionGenerated", true)),
                AppendGeneratedMigrationBookOfWorkItemsRequest.STATE_EXPANDED,
                null));
        // Re-expand: the batch OMITS the seed id (expansion cannot regenerate it)
        // and regenerates the ordinary story under its same id.
        GeneratedMigrationBookOfWorkDto updated = service.appendItems(projectId, draft.id(),
            new AppendGeneratedMigrationBookOfWorkItemsRequest(
                "api:E1",
                List.of(Map.of("id", "api:S1", "type", "story", "parentId", "api:F1",
                    "title", "regenerated story", "expansionGenerated", true)),
                AppendGeneratedMigrationBookOfWorkItemsRequest.STATE_EXPANDED,
                true));
        List<Map<String, Object>> items = itemsOf(updated.bookOfWorkJson());
        Map<String, Object> seed = itemById(items, "api:SEED");
        assertThat(seed).isNotNull();
        assertThat(seed).containsEntry("workItemId", scaffoldWorkItemId);
        assertThat(seed).containsEntry("saveState", "saved");
        assertThat(seed).containsEntry("title", "Scaffold the app and reproduce pom.xml");
        // The ordinary story was still replaced -- the exemption is narrow.
        assertThat(itemById(items, "api:S1")).containsEntry("title", "regenerated story");
    }

    @Test
    @DisplayName("delete story: tombstoned in suppressed_item_ids; re-append of the SAME id is silently skipped (no resurrection); non-story delete rejects")
    void deleteStoryTombstonesAndSuppressesResurrection() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft =
            service.createDraft(projectId, buildSkeletonCreateRequest());

        // Expand a story, then DELETE it.
        service.appendItems(projectId, draft.id(),
            new AppendGeneratedMigrationBookOfWorkItemsRequest(
                "api:E1",
                List.of(Map.of("id", "api:S1", "type", "story", "parentId", "api:F1",
                    "title", "Unwanted story")),
                AppendGeneratedMigrationBookOfWorkItemsRequest.STATE_EXPANDED));
        GeneratedMigrationBookOfWorkDto afterDelete =
            service.deleteStoryItem(projectId, draft.id(), "api:S1");

        List<Map<String, Object>> items = itemsOf(afterDelete.bookOfWorkJson());
        assertThat(itemById(items, "api:S1")).isNull();
        @SuppressWarnings("unchecked")
        List<String> suppressed =
            (List<String>) afterDelete.bookOfWorkJson().get("suppressed_item_ids");
        assertThat(suppressed).containsExactly("api:S1");

        // Re-expansion regenerates the SAME deterministic id — the append
        // silently SKIPS it (deletion survives; the sibling id still lands).
        GeneratedMigrationBookOfWorkDto afterReappend =
            service.appendItems(projectId, draft.id(),
                new AppendGeneratedMigrationBookOfWorkItemsRequest(
                    "api:E1",
                    List.of(
                        Map.of("id", "api:S1", "type", "story", "parentId", "api:F1",
                            "title", "Unwanted story (regenerated)"),
                        Map.of("id", "api:S2", "type", "story", "parentId", "api:F1",
                            "title", "Wanted story")),
                    AppendGeneratedMigrationBookOfWorkItemsRequest.STATE_EXPANDED));
        List<Map<String, Object>> reItems = itemsOf(afterReappend.bookOfWorkJson());
        assertThat(itemById(reItems, "api:S1")).isNull();
        assertThat(itemById(reItems, "api:S2")).isNotNull();

        // Only stories are deletable.
        assertThatThrownBy(() ->
            service.deleteStoryItem(projectId, draft.id(), "api:F1"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Only STORY items");
    }

    @Test
    @DisplayName("two sequential appends for DIFFERENT epics both survive — server-side merge, no lost update")
    void sequentialAppendsForDifferentEpicsBothSurvive() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft =
            service.createDraft(projectId, buildSkeletonCreateRequest());

        service.appendItems(projectId, draft.id(),
            new AppendGeneratedMigrationBookOfWorkItemsRequest(
                "api:E1",
                List.of(Map.of("id", "api:S1", "type", "story", "parentId", "api:F1",
                    "title", "Implement GET /customers/{id}")),
                AppendGeneratedMigrationBookOfWorkItemsRequest.STATE_EXPANDED));

        service.appendItems(projectId, draft.id(),
            new AppendGeneratedMigrationBookOfWorkItemsRequest(
                "api:E2",
                List.of(Map.of("id", "api:S2", "type", "story", "parentId", "api:E2",
                    "title", "Implement pricing lookup")),
                AppendGeneratedMigrationBookOfWorkItemsRequest.STATE_EXPANDED));

        // Reload from the DB — BOTH appends (and both state stamps) survive.
        entityManager.flush();
        entityManager.clear();
        GeneratedMigrationBookOfWorkEntity reloaded =
            repository.findById(draft.id()).orElseThrow();
        List<Map<String, Object>> items = itemsOf(reloaded.getBookOfWorkJson());
        assertThat(items).hasSize(6); // 4 skeleton + 1 + 1
        assertThat(itemById(items, "api:S1")).isNotNull();
        assertThat(itemById(items, "api:S2")).isNotNull();
        assertThat(itemById(items, "api:E1")).containsEntry("expansionState", "expanded");
        assertThat(itemById(items, "api:E2")).containsEntry("expansionState", "expanded");
    }

    @Test
    @DisplayName("append targeting an unknown epic id rejects (controller maps to 400)")
    void unknownEpicIdRejects() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft =
            service.createDraft(projectId, buildSkeletonCreateRequest());

        assertThatThrownBy(() -> service.appendItems(projectId, draft.id(),
            new AppendGeneratedMigrationBookOfWorkItemsRequest(
                "api:NO_SUCH_EPIC",
                List.of(Map.of("id", "api:S9", "type", "story", "parentId", "api:NO_SUCH_EPIC",
                    "title", "Orphan story")),
                AppendGeneratedMigrationBookOfWorkItemsRequest.STATE_EXPANDED)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Unknown epic id");
    }

    @Test
    @DisplayName("append to a non-draft book rejects (controller maps to 400)")
    void nonDraftBookRejects() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft =
            service.createDraft(projectId, buildSkeletonCreateRequest());

        // Move the book past 'draft' (e.g. the reviewer signed it off).
        GeneratedMigrationBookOfWorkEntity entity =
            repository.findById(draft.id()).orElseThrow();
        entity.setStatus(GeneratedMigrationBookOfWorkStatus.REVIEWED);
        repository.save(entity);

        assertThatThrownBy(() -> service.appendItems(projectId, draft.id(),
            new AppendGeneratedMigrationBookOfWorkItemsRequest(
                "api:E1",
                List.of(Map.of("id", "api:S1", "type", "story", "parentId", "api:F1",
                    "title", "Too late")),
                AppendGeneratedMigrationBookOfWorkItemsRequest.STATE_EXPANDED)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("only allowed on a draft book");
    }

    @Test
    @DisplayName("state-only merge (no items) updates the epic's expansionState without touching the item list")
    void stateOnlyMergeUpdatesStateOnly() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft =
            service.createDraft(projectId, buildSkeletonCreateRequest());

        // The gateway marks an epic 'expanding' BEFORE its pipeline runs.
        GeneratedMigrationBookOfWorkDto updated = service.appendItems(projectId, draft.id(),
            new AppendGeneratedMigrationBookOfWorkItemsRequest(
                "api:E1",
                null,
                AppendGeneratedMigrationBookOfWorkItemsRequest.STATE_EXPANDING));

        List<Map<String, Object>> items = itemsOf(updated.bookOfWorkJson());
        assertThat(items).hasSize(4); // unchanged
        assertThat(itemById(items, "api:E1")).containsEntry("expansionState", "expanding");
        assertThat(itemById(items, "api:E2")).containsEntry("expansionState", "not_expanded");
    }
}
