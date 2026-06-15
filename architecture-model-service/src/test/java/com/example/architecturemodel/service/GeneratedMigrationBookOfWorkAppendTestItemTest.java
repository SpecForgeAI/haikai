package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.AppendTestItemRequest;
import com.example.architecturemodel.model.dto.AppendTestItemResponse;
import com.example.architecturemodel.model.dto.GeneratedMigrationBookOfWorkDto;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.GeneratedMigrationBookOfWorkRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
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
 * Service-layer tests for the Holistic Integration/E2E TEST Work Items append
 * ({@link GeneratedMigrationBookOfWorkService#appendTestItem(UUID, UUID,
 * AppendTestItemRequest)}).
 *
 * <p>Spec 2026-06-14 Holistic Integration/E2E TEST Work Items (Spec 2 of 4),
 * Task Group 3. Same {@code @DataJpaTest} + H2 JSONB-domain-aliased harness as
 * the sibling append/save-to-backlog tests; the
 * {@code GeneratedMigrationBookOfWorkItemSaver} is imported so
 * {@code persistOne} writes a real {@code work_item} row.</p>
 *
 * <p>Focused plan (no exhaustive permutations):</p>
 * <ol>
 *   <li>A valid append on a FEATURE creates ONE {@code TEST} {@code work_item}
 *       row (type=TEST, parentId=feature, status=PLANNED, sortOrder=sequence)
 *       AND appends a {@code book_of_work_json} blob item with the stamped
 *       {@code workItemId} + {@code saveState=saved}.</li>
 *   <li>EPIC-level append: the TEST item parents to the epic (sibling to
 *       features) -- loose parent validation permits it.</li>
 *   <li>An unknown parent blob id rejects with
 *       {@code ResourceNotFoundException} (controller maps to 404).</li>
 *   <li>A missing title rejects with {@code IllegalArgumentException}
 *       (controller maps to 400).</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:gmbwappendtestdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
@Import({
    GeneratedMigrationBookOfWorkService.class,
    GeneratedMigrationBookOfWorkService.GeneratedMigrationBookOfWorkItemSaver.class
})
class GeneratedMigrationBookOfWorkAppendTestItemTest {

    @Autowired
    private GeneratedMigrationBookOfWorkService service;

    @Autowired
    private GeneratedMigrationBookOfWorkRepository repository;

    @Autowired
    private WorkItemRepository workItemRepository;

    /**
     * Build a draft already saved-to-backlog: one initiative -> epic -> feature
     * with the feature carrying a saved {@code workItemId}, plus one story under
     * the feature (sequenceOrder 1). The TEST sibling will be appended under the
     * feature (or the epic for the epic-level test).
     */
    private GeneratedMigrationBookOfWorkDto buildSavedDraft(UUID featureWorkItemId, UUID epicWorkItemId) {
        Map<String, Object> bookOfWork = new LinkedHashMap<>();
        Map<String, Object> initiative = new LinkedHashMap<>();
        initiative.put("id", "I1");
        initiative.put("type", "initiative");
        initiative.put("title", "Migrate services");

        Map<String, Object> epic = new LinkedHashMap<>();
        epic.put("id", "E1");
        epic.put("type", "epic");
        epic.put("parentId", "I1");
        epic.put("title", "Customer endpoints");
        epic.put("sequenceOrder", 1);
        if (epicWorkItemId != null) {
            epic.put("workItemId", epicWorkItemId.toString());
            epic.put("saveState", "saved");
        }

        Map<String, Object> feature = new LinkedHashMap<>();
        feature.put("id", "F1");
        feature.put("type", "feature");
        feature.put("parentId", "E1");
        feature.put("title", "GET /customers/{id}");
        feature.put("sequenceOrder", 1);
        if (featureWorkItemId != null) {
            feature.put("workItemId", featureWorkItemId.toString());
            feature.put("saveState", "saved");
        }

        Map<String, Object> story = new LinkedHashMap<>();
        story.put("id", "S1");
        story.put("type", "story");
        story.put("parentId", "F1");
        story.put("title", "Implement GET /customers/{id}");
        story.put("sequenceOrder", 1);

        bookOfWork.put("items", List.of(initiative, epic, feature, story));
        return new GeneratedMigrationBookOfWorkDto(
            null, null,
            UUID.randomUUID(), UUID.randomUUID(),
            null,
            "Saved draft",
            "A saved book of work.",
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
        return items.stream().filter(it -> id.equals(it.get("id"))).findFirst().orElse(null);
    }

    @Test
    @DisplayName("valid append on a FEATURE creates a TEST work_item + appends the stamped blob item")
    void validAppendUnderFeature() {
        UUID projectId = UUID.randomUUID();
        UUID featureWorkItemId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft =
            service.createDraft(projectId, buildSavedDraft(featureWorkItemId, null));

        // Seed the feature's WorkItem so the TEST item's parentId resolves.
        workItemRepository.save(WorkItemEntity.builder()
            .id(featureWorkItemId).projectId(projectId).type("FEATURE")
            .title("GET /customers/{id}").status("PLANNED").sortOrder(1).build());

        AppendTestItemRequest request = new AppendTestItemRequest(
            "F1", featureWorkItemId.toString(),
            "Customer onboarding journey E2E",
            "Verifies the end-to-end customer onboarding across stories.",
            2);

        AppendTestItemResponse response = service.appendTestItem(projectId, draft.id(), request);

        // Work_item row created as a TEST parented to the feature.
        assertThat(response.workItemId()).isNotNull();
        WorkItemEntity created = workItemRepository.findById(response.workItemId()).orElseThrow();
        assertThat(created.getType()).isEqualTo("TEST");
        assertThat(created.getParentId()).isEqualTo(featureWorkItemId);
        assertThat(created.getStatus()).isEqualTo("PLANNED");
        assertThat(created.getSortOrder()).isEqualTo(2);
        assertThat(created.getTitle()).isEqualTo("Customer onboarding journey E2E");

        // Blob item appended with the stamped workItemId + saveState=saved.
        Map<String, Object> reloaded = repository.findById(draft.id()).orElseThrow().getBookOfWorkJson();
        List<Map<String, Object>> items = itemsOf(reloaded);
        Map<String, Object> blob = itemById(items, response.bookItemId());
        assertThat(blob).isNotNull();
        assertThat(blob.get("type")).isEqualTo("TEST");
        assertThat(blob.get("parentId")).isEqualTo("F1");
        assertThat(blob.get("sequenceOrder")).isEqualTo(2);
        assertThat(blob.get("workItemId")).isEqualTo(response.workItemId().toString());
        assertThat(blob.get("saveState")).isEqualTo("saved");
        // Pre-existing items untouched.
        assertThat(itemById(items, "S1")).isNotNull();
        assertThat(itemById(items, "F1")).isNotNull();
    }

    @Test
    @DisplayName("EPIC-level append: TEST item parents to the epic (sibling to features)")
    void validAppendUnderEpic() {
        UUID projectId = UUID.randomUUID();
        UUID epicWorkItemId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft =
            service.createDraft(projectId, buildSavedDraft(null, epicWorkItemId));
        workItemRepository.save(WorkItemEntity.builder()
            .id(epicWorkItemId).projectId(projectId).type("EPIC")
            .title("Customer endpoints").status("PLANNED").sortOrder(1).build());

        AppendTestItemRequest request = new AppendTestItemRequest(
            "E1", epicWorkItemId.toString(),
            "Cross-feature billing integration",
            "Verifies billing across the epic's features.",
            2);

        AppendTestItemResponse response = service.appendTestItem(projectId, draft.id(), request);

        WorkItemEntity created = workItemRepository.findById(response.workItemId()).orElseThrow();
        assertThat(created.getType()).isEqualTo("TEST");
        assertThat(created.getParentId()).isEqualTo(epicWorkItemId);

        Map<String, Object> reloaded = repository.findById(draft.id()).orElseThrow().getBookOfWorkJson();
        Map<String, Object> blob = itemById(itemsOf(reloaded), response.bookItemId());
        assertThat(blob.get("parentId")).isEqualTo("E1");
    }

    @Test
    @DisplayName("unknown parent blob id rejects with ResourceNotFoundException (404)")
    void unknownParentRejected() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft =
            service.createDraft(projectId, buildSavedDraft(UUID.randomUUID(), null));

        AppendTestItemRequest request = new AppendTestItemRequest(
            "DOES_NOT_EXIST", null, "Some test", "desc", 2);

        assertThatThrownBy(() -> service.appendTestItem(projectId, draft.id(), request))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    @DisplayName("missing title rejects with IllegalArgumentException (400)")
    void missingTitleRejected() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft =
            service.createDraft(projectId, buildSavedDraft(UUID.randomUUID(), null));

        AppendTestItemRequest request = new AppendTestItemRequest(
            "F1", null, "  ", "desc", 2);

        assertThatThrownBy(() -> service.appendTestItem(projectId, draft.id(), request))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
