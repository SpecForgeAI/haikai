package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.AppendCapabilityStoryRequest;
import com.example.architecturemodel.model.dto.AppendCapabilityStoryResponse;
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
 * Service-layer tests for the D3 {@code append-capability-story} append
 * ({@link GeneratedMigrationBookOfWorkService#appendCapabilityStory(UUID, UUID,
 * AppendCapabilityStoryRequest)}).
 *
 * <p>Spec: D3 — Internal-behaviour implementation-ready spec generation
 * (2026-06-14, Spec 3 of 6) — Task Group 2. Same {@code @DataJpaTest} + H2
 * JSONB-domain-aliased harness as the sibling {@code append-test-item} /
 * save-to-backlog tests; the {@code GeneratedMigrationBookOfWorkItemSaver} is
 * imported so {@code persistOne} writes a real {@code work_item} row.</p>
 *
 * <p>Focused plan (no exhaustive payload-variation coverage):</p>
 * <ol>
 *   <li>A valid append mints ONE {@code type='STORY'} {@code work_item} row via
 *       {@code persistOne} AND appends a {@code book_of_work_json} blob item
 *       (blob {@code type:"story"}) with the stamped {@code workItemId} +
 *       {@code saveState="saved"} — in one transaction.</li>
 *   <li>The blob item is stamped with {@code source_capability_id} (no DDL — it
 *       rides {@code book_of_work_json}).</li>
 *   <li>The created story is {@code selectEligibleStories}-eligible: blob
 *       {@code type === 'story'} with a non-null {@code workItemId}.</li>
 *   <li>Missing required fields throw {@code IllegalArgumentException}; an
 *       unknown book throws {@code ResourceNotFoundException}.</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:gmbwappendcapdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
@Import({
    GeneratedMigrationBookOfWorkService.class,
    GeneratedMigrationBookOfWorkService.GeneratedMigrationBookOfWorkItemSaver.class
})
class GeneratedMigrationBookOfWorkAppendCapabilityStoryTest {

    @Autowired
    private GeneratedMigrationBookOfWorkService service;

    @Autowired
    private GeneratedMigrationBookOfWorkRepository repository;

    @Autowired
    private WorkItemRepository workItemRepository;

    /** A minimal saved book: just one pre-existing story so the merge is non-empty. */
    private GeneratedMigrationBookOfWorkDto buildSavedDraft() {
        Map<String, Object> bookOfWork = new LinkedHashMap<>();
        Map<String, Object> story = new LinkedHashMap<>();
        story.put("id", "S1");
        story.put("type", "story");
        story.put("title", "An existing API story");
        story.put("sequenceOrder", 1);
        bookOfWork.put("items", List.of(story));
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
    @DisplayName("valid append mints a type=STORY work_item + appends the stamped blob (one transaction)")
    void validAppendMintsStory() {
        UUID projectId = UUID.randomUUID();
        UUID capabilityId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(projectId, buildSavedDraft());

        AppendCapabilityStoryRequest request = new AppendCapabilityStoryRequest(
            capabilityId.toString(),
            "Modernise Daily Risk Hierarchy Load Pipeline",
            "Re-platform the nightly Autosys risk-load chain onto the captured orchestrator.",
            null,
            2);

        AppendCapabilityStoryResponse response =
            service.appendCapabilityStory(projectId, draft.id(), request);

        // A type=STORY work_item row was minted via persistOne.
        assertThat(response.workItemId()).isNotNull();
        WorkItemEntity created = workItemRepository.findById(response.workItemId()).orElseThrow();
        assertThat(created.getType()).isEqualTo("STORY");
        assertThat(created.getStatus()).isEqualTo("PLANNED");
        assertThat(created.getSortOrder()).isEqualTo(2);
        assertThat(created.getTitle()).isEqualTo("Modernise Daily Risk Hierarchy Load Pipeline");

        // The blob item is appended with the stamped workItemId + saveState=saved.
        Map<String, Object> reloaded = repository.findById(draft.id()).orElseThrow().getBookOfWorkJson();
        List<Map<String, Object>> items = itemsOf(reloaded);
        Map<String, Object> blob = itemById(items, response.bookItemId());
        assertThat(blob).isNotNull();
        assertThat(blob.get("workItemId")).isEqualTo(response.workItemId().toString());
        assertThat(blob.get("saveState")).isEqualTo("saved");
        // Pre-existing items are untouched.
        assertThat(itemById(items, "S1")).isNotNull();
    }

    @Test
    @DisplayName("the blob item is stamped with source_capability_id (no DDL — rides book_of_work_json)")
    void blobStampedWithSourceCapabilityId() {
        UUID projectId = UUID.randomUUID();
        UUID capabilityId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(projectId, buildSavedDraft());

        AppendCapabilityStoryRequest request = new AppendCapabilityStoryRequest(
            capabilityId.toString(), "Modernise monitoring", "desc", null, 2);

        AppendCapabilityStoryResponse response =
            service.appendCapabilityStory(projectId, draft.id(), request);

        Map<String, Object> reloaded = repository.findById(draft.id()).orElseThrow().getBookOfWorkJson();
        Map<String, Object> blob = itemById(itemsOf(reloaded), response.bookItemId());
        assertThat(blob.get("source_capability_id")).isEqualTo(capabilityId.toString());
    }

    @Test
    @DisplayName("the created story is selectEligibleStories-eligible: blob type=='story' with a non-null workItemId")
    void createdStoryIsSelectionEligible() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(projectId, buildSavedDraft());

        AppendCapabilityStoryRequest request = new AppendCapabilityStoryRequest(
            UUID.randomUUID().toString(), "Modernise FTP ingestion", "desc", null, 3);

        AppendCapabilityStoryResponse response =
            service.appendCapabilityStory(projectId, draft.id(), request);

        Map<String, Object> reloaded = repository.findById(draft.id()).orElseThrow().getBookOfWorkJson();
        Map<String, Object> blob = itemById(itemsOf(reloaded), response.bookItemId());
        // The two selectEligibleStories gates: it.type === 'story' (handler :1115)
        // + a non-null workItemId. The blob type is LOWERCASE 'story' (not the
        // uppercase work_item.type) so the gateway filter matches.
        assertThat(blob.get("type")).isEqualTo("story");
        assertThat(blob.get("workItemId")).isInstanceOf(String.class);
        assertThat((String) blob.get("workItemId")).isNotBlank();
    }

    @Test
    @DisplayName("missing source_capability_id rejects with IllegalArgumentException (400)")
    void missingSourceCapabilityIdRejected() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(projectId, buildSavedDraft());

        AppendCapabilityStoryRequest request = new AppendCapabilityStoryRequest(
            "  ", "A capability story", "desc", null, 2);

        assertThatThrownBy(() -> service.appendCapabilityStory(projectId, draft.id(), request))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("missing title rejects with IllegalArgumentException (400)")
    void missingTitleRejected() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(projectId, buildSavedDraft());

        AppendCapabilityStoryRequest request = new AppendCapabilityStoryRequest(
            UUID.randomUUID().toString(), "  ", "desc", null, 2);

        assertThatThrownBy(() -> service.appendCapabilityStory(projectId, draft.id(), request))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("unknown book rejects with ResourceNotFoundException (404)")
    void unknownBookRejected() {
        UUID projectId = UUID.randomUUID();
        AppendCapabilityStoryRequest request = new AppendCapabilityStoryRequest(
            UUID.randomUUID().toString(), "A capability story", "desc", null, 2);

        assertThatThrownBy(() ->
            service.appendCapabilityStory(projectId, UUID.randomUUID(), request))
            .isInstanceOf(ResourceNotFoundException.class);
    }
}
