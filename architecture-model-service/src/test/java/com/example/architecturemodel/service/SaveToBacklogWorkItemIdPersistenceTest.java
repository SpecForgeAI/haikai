package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.GeneratedMigrationBookOfWorkDto;
import com.example.architecturemodel.model.dto.SaveGeneratedMigrationBookOfWorkRequest;
import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.GeneratedMigrationBookOfWorkRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Persistence tests for Addition B (Migration Delivery Dashboard spec
 * 2026-05-19, Task Group 1, AC 14): {@code workItemId} writeback into
 * {@code book_of_work_json.items[]} during save-to-backlog.
 *
 * <p>The dashboard's WorkItem linkage is forbidden by spec from using
 * title-matching -- it joins exclusively on the stored {@code workItemId} on
 * each book-of-work item. That id is written back into the {@code book_of_work_json}
 * JSONB column inside the same {@code @Transactional} boundary as the
 * {@link WorkItemEntity} create. This test class proves that contract end-to-end
 * through real Hibernate persistence (no mocks): seeds a draft, runs
 * {@code saveToBacklog}, reloads the draft, and asserts the JSONB payload.</p>
 *
 * <p>Three focused tests per Task Group 1.2:</p>
 * <ol>
 *   <li><b>workItemId is written for every persisted item + per-item rollback.</b>
 *       After save-to-backlog, every successfully-saved item carries the
 *       created WorkItem's id on its {@code workItemId} field. A separate
 *       sub-case simulates a {@code WorkItemRepository.save} failure for one
 *       item mid-batch (sabotaged by blanking the item's title) and verifies
 *       the per-item atomicity guarantee: the failed item ends with
 *       {@code saveState='failed'} and NO {@code workItemId} stamp, while its
 *       neighbours retain their {@code workItemId} stamps.</li>
 *   <li><b>Dashboard join survives a WorkItem rename.</b> After save-to-backlog,
 *       the WorkItem's title is renamed directly via the repository. The stored
 *       {@code workItemId} on the draft still resolves via {@link WorkItemRepository#findById}
 *       to the same row -- proving the join is by id, not by title.</li>
 *   <li><b>Filtered-out items have NO {@code workItemId}.</b> An item excluded
 *       by the save-mode filter (and not pulled in by the parent-inclusion
 *       rule) is never persisted as a WorkItem; correspondingly, its
 *       {@code workItemId} field stays absent on the JSONB blob.</li>
 * </ol>
 *
 * <p>Modeled structurally on
 * {@link GeneratedMigrationBookOfWorkSaveToBacklogTest} (same {@code @DataJpaTest}
 * + H2-PostgreSQL-mode + JSONB-as-JSON domain alias pattern).</p>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * {@code agent-os/specs/2026-05-19-migration-delivery-progress-and-evidence-tracking/spec.md}.
 * Task Group 1.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:savebacklogwidpersistdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
@Import({
    GeneratedMigrationBookOfWorkService.class,
    GeneratedMigrationBookOfWorkService.GeneratedMigrationBookOfWorkItemSaver.class
})
class SaveToBacklogWorkItemIdPersistenceTest {

    @Autowired
    private GeneratedMigrationBookOfWorkService service;

    @Autowired
    private GeneratedMigrationBookOfWorkRepository repository;

    @Autowired
    private WorkItemRepository workItemRepository;

    @Autowired
    private TestEntityManager entityManager;

    /**
     * Build a four-level hierarchy with sibling fields that test
     * "preserve every other field on items[] verbatim" -- including a boxed
     * {@code Double} (confidenceScore) and a boxed {@code Boolean}
     * (needsAttention) so Standing Constraint 2 (boxed-type preservation)
     * has coverage.
     */
    private static List<Map<String, Object>> sampleHierarchy() {
        List<Map<String, Object>> items = new ArrayList<>();
        items.add(item("i-1", "initiative", null, "Initiative One",
            0, "high", "ready_for_spec", Double.valueOf(0.93), Boolean.FALSE));
        items.add(item("e-1", "epic", "i-1", "Epic One",
            1, "high", "ready_for_spec", Double.valueOf(0.87), Boolean.FALSE));
        items.add(item("f-1", "feature", "e-1", "Feature One",
            2, "high", "ready_for_spec", Double.valueOf(0.81), Boolean.FALSE));
        items.add(item("s-1", "story", "f-1", "Story One",
            3, "high", "ready_for_spec", Double.valueOf(0.79), Boolean.TRUE));
        return items;
    }

    private static Map<String, Object> item(
        String id, String type, String parentId, String title,
        int sequenceOrder, String confidence, String readiness,
        Double confidenceScore, Boolean needsAttention) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("type", type);
        if (parentId != null) m.put("parentId", parentId);
        m.put("title", title);
        m.put("description", "Generated description for " + title);
        m.put("acceptanceCriteria", List.of("AC for " + title));
        m.put("sequenceOrder", sequenceOrder);
        m.put("confidence", confidence);
        m.put("readiness", readiness);
        m.put("readinessReasons", List.of("Reason for " + title));
        m.put("traceabilitySummary", "Why " + title + " exists");
        m.put("tags", List.of("migration"));
        // Boxed Double + Boolean -- Standing Constraint 2: preserved verbatim.
        m.put("confidenceScore", confidenceScore);
        m.put("needsAttention", needsAttention);
        return m;
    }

    private GeneratedMigrationBookOfWorkDto seedDraft(UUID projectId, List<Map<String, Object>> hierarchy) {
        Map<String, Object> bookOfWork = new LinkedHashMap<>();
        bookOfWork.put("items", hierarchy);
        GeneratedMigrationBookOfWorkDto request = new GeneratedMigrationBookOfWorkDto(
            null, null,
            UUID.randomUUID(), UUID.randomUUID(),
            null,
            "workItemId-persistence test draft", null,
            null, null, null, bookOfWork,
            null, null, null, null, null);
        return service.createDraft(projectId, request);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> reloadItems(
        GeneratedMigrationBookOfWorkRepository repo, UUID bookId) {
        GeneratedMigrationBookOfWorkEntity reloaded = repo.findById(bookId).orElseThrow();
        Map<String, Object> blob = reloaded.getBookOfWorkJson();
        assertThat(blob).isNotNull();
        Object raw = blob.get("items");
        assertThat(raw).isInstanceOf(List.class);
        return (List<Map<String, Object>>) raw;
    }

    private static Map<String, Object> findById(List<Map<String, Object>> items, String id) {
        return items.stream()
            .filter(it -> id.equals(it.get("id")))
            .findFirst()
            .orElseThrow(() -> new AssertionError("item not found: " + id));
    }

    // ============================================================
    // Test 1 -- workItemId stamped on every saved item + per-item rollback
    // ============================================================

    @Test
    @DisplayName("Test 1 (AC 14): every persisted item is stamped with workItemId in the same transaction; "
        + "per-item failure leaves NO workItemId on the failed item and DOES leave it on the rest")
    void workItemIdStampedOnEveryPersistedItem_andPerItemFailureLeavesNoStamp() {
        // ---- Sub-case A: clean batch -- every saved item gets workItemId. ----
        UUID projectIdHappy = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draftHappy = seedDraft(projectIdHappy, sampleHierarchy());

        service.saveToBacklog(projectIdHappy, draftHappy.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED", false, false, null));

        entityManager.flush();
        entityManager.clear();

        List<Map<String, Object>> reloadedHappy = reloadItems(repository, draftHappy.id());
        assertThat(reloadedHappy).hasSize(4);
        for (Map<String, Object> it : reloadedHappy) {
            assertThat(it.get("workItemId"))
                .as("workItemId stamped on item " + it.get("id"))
                .isNotNull()
                .isInstanceOf(String.class);
            // The stamped id parses as a real UUID.
            UUID parsed = UUID.fromString((String) it.get("workItemId"));
            // And the work_item row actually exists.
            assertThat(workItemRepository.findById(parsed)).isPresent();
            assertThat(it.get("saveState")).isEqualTo("saved");

            // Verify every sibling field is preserved verbatim -- the writeback
            // must not drop or re-shape ANY other field on items[]. Includes
            // boxed Double + Boolean per Standing Constraint 2.
            assertThat(it).containsKeys(
                "id", "type", "title", "description", "acceptanceCriteria",
                "sequenceOrder", "confidence", "readiness", "readinessReasons",
                "traceabilitySummary", "tags", "confidenceScore", "needsAttention");
            assertThat(it.get("confidenceScore")).isInstanceOf(Number.class);
            assertThat(it.get("needsAttention")).isInstanceOf(Boolean.class);
        }

        // Four work_item rows were created.
        assertThat(workItemRepository.countByProjectId(projectIdHappy)).isEqualTo(4);

        // ---- Sub-case B: per-item failure leaves NO workItemId on the failed item ----
        // The existing service uses REQUIRES_NEW propagation per-item so a single
        // WorkItemRepository.save failure does NOT abort the outer batch -- but
        // the failed item must NOT receive a workItemId stamp (atomic per-item
        // semantics) while its neighbours do.
        UUID projectIdFail = UUID.randomUUID();
        List<Map<String, Object>> sabotaged = sampleHierarchy();
        for (Map<String, Object> it : sabotaged) {
            if ("e-1".equals(it.get("id"))) {
                // Blank title -> WorkItemRepository.save path throws
                // IllegalArgumentException inside GeneratedMigrationBookOfWorkItemSaver.
                it.put("title", "");
            }
        }
        GeneratedMigrationBookOfWorkDto draftFail = seedDraft(projectIdFail, sabotaged);

        service.saveToBacklog(projectIdFail, draftFail.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED", false, false, null));

        entityManager.flush();
        entityManager.clear();

        List<Map<String, Object>> reloadedFail = reloadItems(repository, draftFail.id());
        Map<String, Object> failedItem = findById(reloadedFail, "e-1");
        assertThat(failedItem.get("saveState")).isEqualTo("failed");
        assertThat(failedItem.get("workItemId"))
            .as("failed item must NOT carry a workItemId stamp (atomic rollback)")
            .isNull();
        assertThat(failedItem.get("errorMessage")).isNotNull();

        // Non-failed siblings still carry workItemId.
        Map<String, Object> initiative = findById(reloadedFail, "i-1");
        assertThat(initiative.get("saveState")).isEqualTo("saved");
        assertThat(initiative.get("workItemId")).isNotNull();
        Map<String, Object> feature = findById(reloadedFail, "f-1");
        assertThat(feature.get("saveState")).isEqualTo("saved");
        assertThat(feature.get("workItemId")).isNotNull();
        Map<String, Object> story = findById(reloadedFail, "s-1");
        assertThat(story.get("saveState")).isEqualTo("saved");
        assertThat(story.get("workItemId")).isNotNull();
    }

    // ============================================================
    // Test 2 -- dashboard join exclusively by stored workItemId
    // ============================================================

    @Test
    @DisplayName("Test 2 (AC 14, dashboard join precondition): renaming a WorkItem AFTER save still "
        + "resolves the stored workItemId by id -- proves the join is by id, not by title")
    void renamingWorkItemAfterSaveStillResolvesByStoredId() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = seedDraft(projectId, sampleHierarchy());

        service.saveToBacklog(projectId, draft.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED", false, false, null));

        entityManager.flush();
        entityManager.clear();

        // Capture the stored workItemId for the story item from the draft blob.
        List<Map<String, Object>> reloaded = reloadItems(repository, draft.id());
        Map<String, Object> story = findById(reloaded, "s-1");
        UUID storedWorkItemId = UUID.fromString((String) story.get("workItemId"));
        String originalTitle = (String) story.get("title");
        assertThat(originalTitle).isEqualTo("Story One");

        // Rename the WorkItem row directly via the repository.
        WorkItemEntity workItem = workItemRepository.findById(storedWorkItemId).orElseThrow();
        assertThat(workItem.getTitle()).isEqualTo("Story One");
        workItem.setTitle("Story One -- renamed by backlog editor");
        workItemRepository.save(workItem);

        entityManager.flush();
        entityManager.clear();

        // The dashboard-style join: load draft, extract workItemId, findById ->
        // still finds the SAME row even though the title changed.
        Optional<WorkItemEntity> resolved = workItemRepository.findById(storedWorkItemId);
        assertThat(resolved).isPresent();
        assertThat(resolved.get().getId()).isEqualTo(storedWorkItemId);
        assertThat(resolved.get().getTitle())
            .as("WorkItem title was renamed but the join by stored id still finds the row")
            .isEqualTo("Story One -- renamed by backlog editor");

        // Furthermore, the draft's stored workItemId for the story is UNCHANGED
        // -- the save flow never re-stamps based on title.
        List<Map<String, Object>> reReloaded = reloadItems(repository, draft.id());
        Map<String, Object> reStory = findById(reReloaded, "s-1");
        assertThat(UUID.fromString((String) reStory.get("workItemId")))
            .isEqualTo(storedWorkItemId);
    }

    // ============================================================
    // Test 3 -- filtered-out items have no workItemId
    // ============================================================

    @Test
    @DisplayName("Test 3 (Addition B negative path): an item NOT admitted by the save-mode filter has "
        + "no workItemId stamped -- writeback occurs ONLY for items the flow actually persisted")
    void filteredOutItemHasNoWorkItemId() {
        UUID projectId = UUID.randomUUID();
        // Build a hierarchy where the story has confidence='low' so the
        // high_confidence_only filter rejects it. Parents are 'high' and pass
        // the filter directly; parent-inclusion does not pull the story in
        // (parent-inclusion only walks UP, not DOWN, from admitted items).
        List<Map<String, Object>> items = new ArrayList<>();
        items.add(item("i-1", "initiative", null, "Initiative One",
            0, "high", "ready_for_spec", Double.valueOf(0.95), Boolean.FALSE));
        items.add(item("e-1", "epic", "i-1", "Epic One",
            1, "high", "ready_for_spec", Double.valueOf(0.91), Boolean.FALSE));
        items.add(item("f-1", "feature", "e-1", "Feature One",
            2, "high", "ready_for_spec", Double.valueOf(0.88), Boolean.FALSE));
        // Story is filtered out: confidence='low' -> not admitted by
        // high_confidence_only; readiness='blocked' -> reinforces non-admission.
        items.add(item("s-1", "story", "f-1", "Story One -- filtered",
            3, "low", "blocked", Double.valueOf(0.32), Boolean.TRUE));

        GeneratedMigrationBookOfWorkDto draft = seedDraft(projectId, items);

        service.saveToBacklog(projectId, draft.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_HIGH_CONFIDENCE_ONLY,
                "PLANNED", false, false, null));

        entityManager.flush();
        entityManager.clear();

        // Only three rows persisted (the high-confidence trio); the story was
        // never sent to WorkItemRepository.save.
        assertThat(workItemRepository.countByProjectId(projectId)).isEqualTo(3);

        // On the draft, the three persisted items carry workItemId; the
        // filtered-out story does NOT.
        List<Map<String, Object>> reloaded = reloadItems(repository, draft.id());
        assertThat(reloaded).hasSize(4);

        Map<String, Object> initiative = findById(reloaded, "i-1");
        Map<String, Object> epic = findById(reloaded, "e-1");
        Map<String, Object> feature = findById(reloaded, "f-1");
        Map<String, Object> story = findById(reloaded, "s-1");

        assertThat(initiative.get("workItemId")).isNotNull();
        assertThat(epic.get("workItemId")).isNotNull();
        assertThat(feature.get("workItemId")).isNotNull();
        assertThat(story.get("workItemId"))
            .as("filtered-out story must NOT receive a workItemId stamp")
            .isNull();
        // And the filtered-out story has NO saveState='saved' or 'failed'
        // marker either -- the orchestrator did not touch it at all.
        assertThat(story.get("saveState")).isNull();
        // Original confidence/readiness/title are preserved verbatim.
        assertThat(story.get("title")).isEqualTo("Story One -- filtered");
        assertThat(story.get("confidence")).isEqualTo("low");
        assertThat(story.get("readiness")).isEqualTo("blocked");
    }
}
