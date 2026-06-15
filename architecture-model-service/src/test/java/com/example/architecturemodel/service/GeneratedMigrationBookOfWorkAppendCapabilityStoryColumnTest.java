package com.example.architecturemodel.service;

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

/**
 * D4 service-layer test: {@code appendCapabilityStory} now writes the new
 * {@code work_item.source_capability_id} COLUMN on the minted story (in addition
 * to the D3 {@code book_of_work_json} blob stamp), so the gate's coverage query
 * is a structured join.
 *
 * <p>Spec: D4 -- Carry-over Completeness Gate (2026-06-14, Spec 4 of 6) -- Task
 * Group 1. Uses the same JSONB-domain-aliased {@code @DataJpaTest} H2 harness as
 * the sibling {@code GeneratedMigrationBookOfWorkAppendCapabilityStoryTest} so
 * {@code persistOne} writes a real {@code work_item} row (the column round-trips
 * live here -- the JSONB domain alias makes the {@code work_item} table
 * H2-creatable, unlike the plain {@code @DataJpaTest} estate).</p>
 *
 * <p>Focused assertions (D3 behaviour stays unchanged; D4 adds the column):</p>
 * <ol>
 *   <li>the minted {@code work_item} row carries {@code source_capability_id} on
 *       the COLUMN (the new structured provenance the gate joins on);</li>
 *   <li>the {@code book_of_work_json} blob item STILL carries
 *       {@code source_capability_id} (D3's stamp is untouched); AND</li>
 *   <li>the coverage-data finder ({@code findByProjectIdAndSourceCapabilityIdIsNotNull})
 *       returns exactly the cited stories so the gateway can derive the
 *       cited-capability set (Task 1.6 work-items-by-source_capability_id read).</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:gmbwappendcapcoldb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
@Import({
    GeneratedMigrationBookOfWorkService.class,
    GeneratedMigrationBookOfWorkService.GeneratedMigrationBookOfWorkItemSaver.class
})
class GeneratedMigrationBookOfWorkAppendCapabilityStoryColumnTest {

    @Autowired
    private GeneratedMigrationBookOfWorkService service;

    @Autowired
    private GeneratedMigrationBookOfWorkRepository repository;

    @Autowired
    private WorkItemRepository workItemRepository;

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
    @DisplayName("appendCapabilityStory sets the work_item.source_capability_id COLUMN on the minted story")
    void appendCapabilityStoryWritesColumn() {
        UUID projectId = UUID.randomUUID();
        UUID capabilityId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(projectId, buildSavedDraft());

        AppendCapabilityStoryRequest request = new AppendCapabilityStoryRequest(
            capabilityId.toString(),
            "Modernise Daily Risk Hierarchy Load Pipeline",
            "Re-platform the nightly Autosys risk-load chain.",
            null,
            2);

        AppendCapabilityStoryResponse response =
            service.appendCapabilityStory(projectId, draft.id(), request);

        // The COLUMN carries the source capability id (the gate's join key).
        WorkItemEntity created =
            workItemRepository.findById(response.workItemId()).orElseThrow();
        assertThat(created.getSourceCapabilityId())
            .as("the minted work_item must carry source_capability_id on the COLUMN")
            .isEqualTo(capabilityId);
        assertThat(created.getType()).isEqualTo("STORY");
    }

    @Test
    @DisplayName("appendCapabilityStory STILL stamps source_capability_id on the book_of_work_json blob (D3 unchanged)")
    void appendCapabilityStoryStillStampsBlob() {
        UUID projectId = UUID.randomUUID();
        UUID capabilityId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(projectId, buildSavedDraft());

        AppendCapabilityStoryRequest request = new AppendCapabilityStoryRequest(
            capabilityId.toString(), "Modernise monitoring", "desc", null, 2);

        AppendCapabilityStoryResponse response =
            service.appendCapabilityStory(projectId, draft.id(), request);

        // The blob stamp (D3) is untouched -- both the blob AND the column now
        // carry the provenance.
        Map<String, Object> reloaded =
            repository.findById(draft.id()).orElseThrow().getBookOfWorkJson();
        Map<String, Object> blob = itemById(itemsOf(reloaded), response.bookItemId());
        assertThat(blob).isNotNull();
        assertThat(blob.get("source_capability_id")).isEqualTo(capabilityId.toString());
    }

    @Test
    @DisplayName("the coverage-data finder returns cited work_items (source_capability_id not null) so the gate can derive the cited-capability set")
    void coverageFinderReturnsCitedWorkItems() {
        UUID projectId = UUID.randomUUID();
        UUID citedCapabilityId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(projectId, buildSavedDraft());

        // Cite ONE capability -> a story with the source_capability_id column set.
        AppendCapabilityStoryResponse cited = service.appendCapabilityStory(
            projectId, draft.id(),
            new AppendCapabilityStoryRequest(
                citedCapabilityId.toString(), "Modernise FTP ingestion", "desc", null, 1));

        // Persist an ORDINARY (un-cited) story directly -- it must NOT appear in
        // the cited read (its source_capability_id stays null).
        workItemRepository.save(WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .type("STORY")
            .title("An ordinary API story")
            .build());

        List<WorkItemEntity> citedRows =
            workItemRepository.findByProjectIdAndSourceCapabilityIdIsNotNull(projectId);

        // Exactly the cited story is returned; its capability id is the join key.
        assertThat(citedRows).hasSize(1);
        assertThat(citedRows.get(0).getId()).isEqualTo(cited.workItemId());
        assertThat(citedRows.get(0).getSourceCapabilityId()).isEqualTo(citedCapabilityId);
    }
}
