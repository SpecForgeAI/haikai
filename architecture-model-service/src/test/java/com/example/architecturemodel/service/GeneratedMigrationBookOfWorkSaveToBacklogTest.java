package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.GeneratedMigrationBookOfWorkDto;
import com.example.architecturemodel.model.dto.SaveGeneratedMigrationBookOfWorkRequest;
import com.example.architecturemodel.model.dto.SaveGeneratedMigrationBookOfWorkResponse;
import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkStatus;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.GeneratedMigrationBookOfWorkRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
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
import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkEntity;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Service-layer tests for the {@code save-to-backlog} half of
 * {@link GeneratedMigrationBookOfWorkService} -- Task Group 8.
 *
 * <p>Each test seeds a draft with a small Initiative -> Epic -> Feature -> Story
 * hierarchy, calls {@code saveToBacklog} with various save-mode + selection
 * combinations, and asserts on the resulting {@code work_item} rows + draft
 * state mutations.</p>
 *
 * <p>Tests covered (Group 8 acceptance criteria):</p>
 * <ol>
 *   <li>save-all: every item saved; hierarchy + sequence preserved.</li>
 *   <li>save-selected: only {@code selectedItemIds} saved.</li>
 *   <li>save high-confidence-only: only {@code confidence='high'} items saved
 *       BUT parent-inclusion rule fires.</li>
 *   <li>save ready-for-spec-only: only {@code readiness='ready_for_spec'} items
 *       saved with parent-inclusion.</li>
 *   <li>Hierarchy preservation: {@code parentId} on saved rows points to the
 *       in-batch parent's new {@code workItemId}.</li>
 *   <li>Sequence preservation: created rows respect {@code sequenceOrder}.</li>
 *   <li>Idempotency: re-running save-to-backlog skips already-saved items.</li>
 *   <li>Per-item failure isolation: one failure does not abort the batch.</li>
 *   <li>Tag idempotency: re-save with same prefix does not duplicate tags.</li>
 *   <li>No destructive overwrite: existing {@code work_item} rows are unchanged.</li>
 * </ol>
 *
 * <p>Spec: Product Manager Migration Delivery Plan + Draft Book-of-Work
 * Generation (2026-05-17) -- Task Group 8.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:gmbwsavedb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
@Import({
    GeneratedMigrationBookOfWorkService.class,
    GeneratedMigrationBookOfWorkService.GeneratedMigrationBookOfWorkItemSaver.class
})
class GeneratedMigrationBookOfWorkSaveToBacklogTest {

    @Autowired
    private GeneratedMigrationBookOfWorkService service;

    @Autowired
    private GeneratedMigrationBookOfWorkRepository repository;

    @Autowired
    private WorkItemRepository workItemRepository;

    @Autowired
    private MigrationStorySpecGenerationRepository specGenerationRepository;

    @Autowired
    private TestEntityManager entityManager;

    /**
     * Build a minimal four-level hierarchy:
     * Initiative i-1 (high, ready) -> Epic e-1 (medium, needs_focused_context)
     *   -> Feature f-1 (high, ready_for_spec)
     *     -> Story s-1 (low, blocked)
     */
    private static List<Map<String, Object>> sampleHierarchy() {
        List<Map<String, Object>> items = new ArrayList<>();
        items.add(item("i-1", "initiative", null, "Initiative One", 0, "high", "ready_for_spec"));
        items.add(item("e-1", "epic", "i-1", "Epic One", 1, "medium", "needs_focused_context"));
        items.add(item("f-1", "feature", "e-1", "Feature One", 2, "high", "ready_for_spec"));
        items.add(item("s-1", "story", "f-1", "Story One", 3, "low", "blocked"));
        return items;
    }

    private static Map<String, Object> item(
        String id, String type, String parentId, String title,
        int sequenceOrder, String confidence, String readiness) {
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
        m.put("tags", List.of("migration", "wave-1"));
        return m;
    }

    private GeneratedMigrationBookOfWorkDto seedDraft(UUID projectId) {
        return seedDraftForTuple(projectId, UUID.randomUUID(), UUID.randomUUID());
    }

    /**
     * Seed a draft on an EXPLICIT (currentArch, targetArch) tuple — the
     * superseded-cleanup tests create two generations on the SAME tuple so
     * the Q-6 archive-on-regenerate flow fires.
     */
    private GeneratedMigrationBookOfWorkDto seedDraftForTuple(
        UUID projectId, UUID currentArchitectureId, UUID targetArchitectureId) {
        Map<String, Object> bookOfWork = new LinkedHashMap<>();
        bookOfWork.put("items", sampleHierarchy());
        GeneratedMigrationBookOfWorkDto request = new GeneratedMigrationBookOfWorkDto(
            null, null,
            currentArchitectureId, targetArchitectureId,
            null,
            "Save-to-backlog test draft", null,
            null, null, null, bookOfWork,
            null, null, null, null, null);
        return service.createDraft(projectId, request);
    }

    @Test
    @DisplayName("save-all writes every item; sequence + hierarchy preserved")
    void saveAllWritesEveryItemPreservingHierarchy() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = seedDraft(projectId);

        SaveGeneratedMigrationBookOfWorkResponse response = service.saveToBacklog(
            projectId, draft.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED", false, false, null));

        entityManager.flush();
        entityManager.clear();

        List<WorkItemEntity> rows =
            workItemRepository.findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(projectId);
        assertThat(rows).hasSize(4);

        // Types are uppercased by the writer.
        assertThat(rows).extracting(WorkItemEntity::getType).containsExactlyInAnyOrder(
            "INITIATIVE", "EPIC", "FEATURE", "STORY");

        // Sequence order matches.
        assertThat(rows.get(0).getSortOrder()).isEqualTo(0);
        assertThat(rows.get(1).getSortOrder()).isEqualTo(1);
        assertThat(rows.get(2).getSortOrder()).isEqualTo(2);
        assertThat(rows.get(3).getSortOrder()).isEqualTo(3);

        // Hierarchy: each child's parentId points to the saved parent in the
        // same batch. Walk the chain via the work_item rows.
        WorkItemEntity initiative = rows.stream()
            .filter(r -> "INITIATIVE".equals(r.getType())).findFirst().orElseThrow();
        WorkItemEntity epic = rows.stream()
            .filter(r -> "EPIC".equals(r.getType())).findFirst().orElseThrow();
        WorkItemEntity feature = rows.stream()
            .filter(r -> "FEATURE".equals(r.getType())).findFirst().orElseThrow();
        WorkItemEntity story = rows.stream()
            .filter(r -> "STORY".equals(r.getType())).findFirst().orElseThrow();

        assertThat(initiative.getParentId()).isNull();
        assertThat(epic.getParentId()).isEqualTo(initiative.getId());
        assertThat(feature.getParentId()).isEqualTo(epic.getId());
        assertThat(story.getParentId()).isEqualTo(feature.getId());

        // Response surfaces draft -> 'saved' transition.
        assertThat(response.draftStatus()).isEqualTo(GeneratedMigrationBookOfWorkStatus.SAVED);
        @SuppressWarnings("unchecked")
        Map<String, Object> counts = (Map<String, Object>) response.counts();
        assertThat(counts.get("saved")).isEqualTo(4);
        assertThat(counts.get("failed")).isEqualTo(0);
    }

    @Test
    @DisplayName("save-selected writes only selected item ids")
    void saveSelectedWritesOnlyChosenIds() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = seedDraft(projectId);

        // Note: selecting just the feature without its ancestors still admits
        // the ancestor chain via the parent-inclusion rule. We instead select
        // all four ids EXCEPT the story to test the strict-selection semantics.
        service.saveToBacklog(projectId, draft.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                List.of("i-1", "e-1", "f-1"),
                null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_SELECTED,
                "PLANNED", false, false, null));

        entityManager.flush();
        entityManager.clear();

        List<WorkItemEntity> rows =
            workItemRepository.findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(projectId);
        assertThat(rows).hasSize(3);
        assertThat(rows).extracting(WorkItemEntity::getType)
            .containsExactlyInAnyOrder("INITIATIVE", "EPIC", "FEATURE");
        assertThat(rows).noneMatch(r -> "STORY".equals(r.getType()));
    }

    @Test
    @DisplayName("save high-confidence-only admits parents via the parent-inclusion rule (Q-8)")
    void saveHighConfidenceOnlyAppliesParentInclusion() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = seedDraft(projectId);

        // In the seed: i-1 = high, e-1 = medium, f-1 = high, s-1 = low.
        // High-confidence admits i-1 + f-1; parent-inclusion adds e-1 (parent
        // of f-1). Final set: { i-1, e-1, f-1 }. s-1 is NOT included.
        service.saveToBacklog(projectId, draft.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_HIGH_CONFIDENCE_ONLY,
                "PLANNED", false, false, null));

        entityManager.flush();
        entityManager.clear();

        List<WorkItemEntity> rows =
            workItemRepository.findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(projectId);
        assertThat(rows).hasSize(3);
        assertThat(rows).extracting(WorkItemEntity::getType)
            .containsExactlyInAnyOrder("INITIATIVE", "EPIC", "FEATURE");
    }

    @Test
    @DisplayName("save ready-for-spec-only admits parents via the parent-inclusion rule (Q-8)")
    void saveReadyForSpecOnlyAppliesParentInclusion() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = seedDraft(projectId);

        // ready_for_spec items are i-1 + f-1; parent-inclusion adds e-1. s-1
        // (readiness=blocked) is excluded.
        service.saveToBacklog(projectId, draft.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_READY_FOR_SPEC_ONLY,
                "PLANNED", false, false, null));

        entityManager.flush();
        entityManager.clear();

        List<WorkItemEntity> rows =
            workItemRepository.findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(projectId);
        assertThat(rows).hasSize(3);
        assertThat(rows).extracting(WorkItemEntity::getType)
            .containsExactlyInAnyOrder("INITIATIVE", "EPIC", "FEATURE");
    }

    @Test
    @DisplayName("re-run refreshes an already-saved item's title/description from the blob (post-save re-expansion), identity untouched")
    void reRunRefreshesExistingWorkItemTextFromBlob() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = seedDraft(projectId);
        service.saveToBacklog(projectId, draft.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED", false, false, null));
        entityManager.flush();
        entityManager.clear();

        // A post-save re-expansion rewrote one story's text under the SAME id.
        GeneratedMigrationBookOfWorkEntity entity = repository.findById(draft.id()).orElseThrow();
        Map<String, Object> blob = new LinkedHashMap<>(entity.getBookOfWorkJson());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> items = new ArrayList<>((List<Map<String, Object>>) blob.get("items"));
        Map<String, Object> story = null;
        for (int i = 0; i < items.size(); i++) {
            Map<String, Object> it = new LinkedHashMap<>(items.get(i));
            if ("story".equalsIgnoreCase(String.valueOf(it.get("type"))) && story == null) {
                it.put("title", "Regenerated by the fixed planner");
                it.put("description", "New text, same identity");
                story = it;
            }
            items.set(i, it);
        }
        assertThat(story).isNotNull();
        UUID workItemId = UUID.fromString(String.valueOf(story.get("workItemId")));
        blob.put("items", items);
        entity.setBookOfWorkJson(blob);
        repository.save(entity);
        entityManager.flush();
        entityManager.clear();

        SaveGeneratedMigrationBookOfWorkResponse second = service.saveToBacklog(
            projectId, draft.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED", false, false, null));
        entityManager.flush();
        entityManager.clear();

        assertThat(workItemRepository.countByProjectId(projectId)).isEqualTo(4); // nothing minted
        var refreshed = workItemRepository.findById(workItemId).orElseThrow();
        assertThat(refreshed.getTitle()).isEqualTo("Regenerated by the fixed planner");
        // The saver appends its own sections after the blob description.
        assertThat(refreshed.getDescription()).startsWith("New text, same identity");
        @SuppressWarnings("unchecked")
        Map<String, Object> counts = (Map<String, Object>) second.counts();
        assertThat(counts.get("refreshed_existing")).isEqualTo(1);
        assertThat(counts.get("skipped_already_saved")).isEqualTo(4);
    }

    @Test
    @DisplayName("idempotency: re-running save-to-backlog skips already-saved items (Q-5)")
    void idempotentReRunSkipsAlreadySaved() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = seedDraft(projectId);

        // First save: writes 4 rows.
        service.saveToBacklog(projectId, draft.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED", false, false, null));
        entityManager.flush();
        entityManager.clear();
        long countAfterFirst = workItemRepository.countByProjectId(projectId);
        assertThat(countAfterFirst).isEqualTo(4);

        // Second save with the same parameters: every item is already saveState='saved'
        // on the persisted draft, so no new work_item rows are inserted.
        SaveGeneratedMigrationBookOfWorkResponse second = service.saveToBacklog(
            projectId, draft.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED", false, false, null));
        entityManager.flush();
        entityManager.clear();
        long countAfterSecond = workItemRepository.countByProjectId(projectId);
        assertThat(countAfterSecond).isEqualTo(4);

        @SuppressWarnings("unchecked")
        Map<String, Object> counts = (Map<String, Object>) second.counts();
        assertThat(counts.get("saved")).isEqualTo(0);
        assertThat(counts.get("skipped_already_saved")).isEqualTo(4);
    }

    @Test
    @DisplayName("per-item failure isolation: one failure leaves the rest committed")
    void perItemFailureLeavesNeighboursIntact() {
        UUID projectId = UUID.randomUUID();

        // Build a hierarchy where one item is missing a required field (title).
        // The writer rejects it with IllegalArgumentException; the orchestrator
        // marks it failed and continues to the next item.
        List<Map<String, Object>> items = sampleHierarchy();
        // Sabotage the epic by blanking its title.
        for (Map<String, Object> it : items) {
            if ("e-1".equals(it.get("id"))) {
                it.put("title", "");  // blank -> writer throws
            }
        }
        Map<String, Object> bookOfWork = new LinkedHashMap<>();
        bookOfWork.put("items", items);
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(
            projectId,
            new GeneratedMigrationBookOfWorkDto(
                null, null,
                UUID.randomUUID(), UUID.randomUUID(),
                null,
                "Per-item failure test", null,
                null, null, null, bookOfWork,
                null, null, null, null, null));

        SaveGeneratedMigrationBookOfWorkResponse response = service.saveToBacklog(
            projectId, draft.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED", false, false, null));

        entityManager.flush();
        entityManager.clear();

        // Three items succeeded; one failed. The epic's failure does NOT abort
        // the whole batch (Q-5). The feature/story below the failed epic still
        // get created -- their parentId resolves to null (no in-batch parent
        // was saved) but they remain valid standalone work items.
        List<WorkItemEntity> rows =
            workItemRepository.findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(projectId);
        assertThat(rows).hasSize(3);
        assertThat(rows).extracting(WorkItemEntity::getType)
            .containsExactlyInAnyOrder("INITIATIVE", "FEATURE", "STORY");

        // The draft transitioned to partially_saved.
        assertThat(response.draftStatus())
            .isEqualTo(GeneratedMigrationBookOfWorkStatus.PARTIALLY_SAVED);
        @SuppressWarnings("unchecked")
        Map<String, Object> counts = (Map<String, Object>) response.counts();
        assertThat(counts.get("saved")).isEqualTo(3);
        assertThat(counts.get("failed")).isEqualTo(1);
        assertThat(response.failedItems()).hasSize(1);
        assertThat(response.failedItems().get(0).get("itemId")).isEqualTo("e-1");
    }

    @Test
    @DisplayName("tag prefix idempotency: re-save with same prefix does NOT create duplicate tags (Q-10)")
    void tagPrefixIdempotency() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = seedDraft(projectId);

        // First save with tagPrefix='mig-' -- every saved row gets the prefixed
        // tags.
        service.saveToBacklog(projectId, draft.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED", false, false, "mig-"));
        entityManager.flush();
        entityManager.clear();

        List<WorkItemEntity> rows =
            workItemRepository.findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(projectId);
        for (WorkItemEntity r : rows) {
            Map<String, Object> tags = r.getTagsJson();
            assertThat(tags).isNotNull();
            assertThat(tags.keySet()).containsExactlyInAnyOrder("mig-migration", "mig-wave-1");
        }

        // Second save: every item is already 'saved' on the draft so the writer
        // does not run again -- no duplicate work items, no duplicated tags.
        service.saveToBacklog(projectId, draft.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED", false, false, "mig-"));
        entityManager.flush();
        entityManager.clear();
        long countAfter = workItemRepository.countByProjectId(projectId);
        assertThat(countAfter).isEqualTo(4);

        // Inspect a saved row's tags: still just the two original entries, no
        // duplicate 'mig-mig-migration' or similar.
        WorkItemEntity firstRow = workItemRepository
            .findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(projectId).get(0);
        assertThat(firstRow.getTagsJson().keySet()).hasSize(2);
    }

    @Test
    @DisplayName("includeTraceabilityInDescription + includeReadinessInDescription stamp the saved description")
    void traceabilityAndReadinessAppendedToDescription() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = seedDraft(projectId);

        service.saveToBacklog(projectId, draft.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED",
                true,   // includeTraceabilityInDescription
                true,   // includeReadinessInDescription
                null));
        entityManager.flush();
        entityManager.clear();

        WorkItemEntity initiative = workItemRepository
            .findByProjectIdAndTypeOrderBySortOrderAscCreatedAtAscIdAsc(projectId, "INITIATIVE")
            .get(0);
        String desc = initiative.getDescription();
        assertThat(desc).contains("Generated description for Initiative One");
        assertThat(desc).contains("Acceptance Criteria");
        assertThat(desc).contains("Traceability");
        assertThat(desc).contains("Why Initiative One exists");
        assertThat(desc).contains("Readiness: ready_for_spec");
        assertThat(desc).contains("Reason for Initiative One");
    }

    @Test
    @DisplayName("excluded_item_ids skips items regardless of save mode")
    void excludedItemIdsSkipsItems() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = seedDraft(projectId);

        service.saveToBacklog(projectId, draft.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null,
                List.of("s-1"),
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED", false, false, null));

        entityManager.flush();
        entityManager.clear();

        List<WorkItemEntity> rows =
            workItemRepository.findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(projectId);
        assertThat(rows).hasSize(3);
        assertThat(rows).noneMatch(r -> "STORY".equals(r.getType()));
    }

    @Test
    @DisplayName("no destructive overwrite: existing work_item rows are unchanged after save-to-backlog")
    void noDestructiveOverwriteOfExistingRows() {
        UUID projectId = UUID.randomUUID();

        // Pre-seed an unrelated work_item directly via the repository.
        WorkItemEntity existing = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .type("STORY")
            .title("Pre-existing story; do not touch")
            .description("Hand-curated content")
            .status("IN_PROGRESS")
            .sortOrder(100)
            .build();
        workItemRepository.save(existing);
        entityManager.flush();
        entityManager.clear();

        GeneratedMigrationBookOfWorkDto draft = seedDraft(projectId);
        service.saveToBacklog(projectId, draft.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED", false, false, null));
        entityManager.flush();
        entityManager.clear();

        // Original row is untouched.
        WorkItemEntity reloaded = workItemRepository.findById(existing.getId()).orElseThrow();
        assertThat(reloaded.getTitle()).isEqualTo("Pre-existing story; do not touch");
        assertThat(reloaded.getDescription()).isEqualTo("Hand-curated content");
        assertThat(reloaded.getStatus()).isEqualTo("IN_PROGRESS");
        assertThat(reloaded.getSortOrder()).isEqualTo(100);

        // Total rows: 1 original + 4 from the save = 5.
        assertThat(workItemRepository.countByProjectId(projectId)).isEqualTo(5);
    }

    // -----------------------------------------------------------------
    // Superseded-plan cleanup (2026-07-27): regenerating + saving must not
    // accumulate every generation's work items on the Roadmap/Backlog.
    // -----------------------------------------------------------------

    @Test
    @DisplayName("regenerate + save DELETES the superseded book's work items (and their spec rows); manual items survive")
    void supersededBookWorkItemsAreDeletedOnSave() {
        UUID projectId = UUID.randomUUID();
        UUID currentArch = UUID.randomUUID();
        UUID targetArch = UUID.randomUUID();
        SaveGeneratedMigrationBookOfWorkRequest saveAll =
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED", false, false, null);

        // Generation 1: create + save -> 4 work items in the backlog.
        GeneratedMigrationBookOfWorkDto gen1 =
            seedDraftForTuple(projectId, currentArch, targetArch);
        service.saveToBacklog(projectId, gen1.id(), saveAll);
        entityManager.flush();
        entityManager.clear();
        List<UUID> gen1WorkItemIds = workItemRepository
            .findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(projectId)
            .stream().map(WorkItemEntity::getId).toList();
        assertThat(gen1WorkItemIds).hasSize(4);

        // A manually-created backlog item (not referenced by ANY generated
        // book) — the cleanup must never touch it.
        WorkItemEntity manual = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .type("STORY")
            .title("Manually added story")
            .status("PLANNED")
            .sortOrder(50)
            .build();
        workItemRepository.save(manual);

        // A spec-generation row on one of gen-1's items — deleted with it so
        // project-scoped surfaces (stale-count) never count phantom rows.
        com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity specRow =
            com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity.builder()
                .id(UUID.randomUUID())
                .projectId(projectId)
                .workItemId(gen1WorkItemIds.get(0))
                .bookOfWorkId(gen1.id())
                .status("generated")
                .generatedSpecText("gen-1 spec")
                .build();
        specGenerationRepository.save(specRow);
        entityManager.flush();
        entityManager.clear();

        // Generation 2 on the SAME tuple: Q-6 archives gen 1 at create time…
        GeneratedMigrationBookOfWorkDto gen2 =
            seedDraftForTuple(projectId, currentArch, targetArch);
        assertThat(repository.findById(gen1.id()).orElseThrow().getStatus())
            .isEqualTo(GeneratedMigrationBookOfWorkStatus.ARCHIVED);

        // …and SAVING gen 2 deletes gen 1's now-superseded work items.
        SaveGeneratedMigrationBookOfWorkResponse response =
            service.saveToBacklog(projectId, gen2.id(), saveAll);
        entityManager.flush();
        entityManager.clear();

        List<WorkItemEntity> remaining = workItemRepository
            .findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(projectId);
        // 4 fresh gen-2 items + the manual survivor; gen-1's 4 are GONE.
        assertThat(remaining).hasSize(5);
        assertThat(remaining).extracting(WorkItemEntity::getId)
            .doesNotContainAnyElementsOf(gen1WorkItemIds)
            .contains(manual.getId());

        // The superseded item's spec row went with it.
        assertThat(specGenerationRepository.findById(specRow.getId())).isEmpty();

        // The response reports what was cleaned.
        @SuppressWarnings("unchecked")
        Map<String, Object> counts = (Map<String, Object>) response.counts();
        assertThat(counts.get("superseded_work_items_deleted")).isEqualTo(4);
    }

    @Test
    @DisplayName("an entirely-failed save does NOT delete the superseded items (never empty the backlog on failure)")
    void failedSaveLeavesSupersededItemsAlone() {
        UUID projectId = UUID.randomUUID();
        UUID currentArch = UUID.randomUUID();
        UUID targetArch = UUID.randomUUID();
        SaveGeneratedMigrationBookOfWorkRequest saveAll =
            new SaveGeneratedMigrationBookOfWorkRequest(
                null, null,
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED", false, false, null);

        GeneratedMigrationBookOfWorkDto gen1 =
            seedDraftForTuple(projectId, currentArch, targetArch);
        service.saveToBacklog(projectId, gen1.id(), saveAll);
        entityManager.flush();
        entityManager.clear();
        assertThat(workItemRepository.countByProjectId(projectId)).isEqualTo(4);

        // Generation 2 with NOTHING admitted (everything excluded): savedCount
        // and skippedAlreadySaved are both 0 -> the cleanup must not run.
        GeneratedMigrationBookOfWorkDto gen2 =
            seedDraftForTuple(projectId, currentArch, targetArch);
        service.saveToBacklog(projectId, gen2.id(),
            new SaveGeneratedMigrationBookOfWorkRequest(
                null,
                List.of("i-1", "e-1", "f-1", "s-1"),
                SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
                "PLANNED", false, false, null));
        entityManager.flush();
        entityManager.clear();

        // Gen-1's items are still there — the backlog was not emptied.
        assertThat(workItemRepository.countByProjectId(projectId)).isEqualTo(4);
    }
}
