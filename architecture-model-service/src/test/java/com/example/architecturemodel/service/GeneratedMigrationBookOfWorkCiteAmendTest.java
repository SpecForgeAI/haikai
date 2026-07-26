package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.AddWorkItemRequest;
import com.example.architecturemodel.model.dto.AddWorkItemResponse;
import com.example.architecturemodel.model.dto.AmendBookItemRequest;
import com.example.architecturemodel.model.dto.AmendBookItemResponse;
import com.example.architecturemodel.model.dto.CiteFindingRequest;
import com.example.architecturemodel.model.dto.CiteFindingResponse;
import com.example.architecturemodel.model.dto.GeneratedMigrationBookOfWorkDto;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.GeneratedMigrationBookOfWorkRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
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
 * Carry-over triage (2026-07-26,
 * {@code agent-os/planning/2026-07-26-carry-over-triage-build-plan.md}) —
 * service-layer pins for the two new item-patch endpoints + the extended
 * add-item stamps:
 *
 * <ol>
 *   <li>cite-finding adds the id to {@code discoveryFindingReferences} (the D4
 *       gate's citation array) and is IDEMPOTENT;</li>
 *   <li>amend replaces the description, APPENDS acceptance criteria, cites the
 *       finding, mirrors the description onto the linked work_item, and MARKS
 *       the spec-generation row STALE (stale + stale_reason + stale_marked_at)
 *       so {@code isStorySpecReady} drops the story until regeneration;</li>
 *   <li>amend on a story with NO spec rows still succeeds (0 marked) — "no
 *       spec" already reads as not-ready;</li>
 *   <li>add-item stamps the triage-era workstream / acceptanceCriteria /
 *       discoveryFindingReferences onto the blob item (the NEW-STORY
 *       disposition's citation path);</li>
 *   <li>non-story targets and no-op amendments are rejected 400.</li>
 * </ol>
 *
 * <p>Same JSONB-domain-aliased {@code @DataJpaTest} H2 harness as the sibling
 * book-of-work tests.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:gmbwciteamenddb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
@Import({
    GeneratedMigrationBookOfWorkService.class,
    GeneratedMigrationBookOfWorkService.GeneratedMigrationBookOfWorkItemSaver.class
})
class GeneratedMigrationBookOfWorkCiteAmendTest {

    @Autowired
    private GeneratedMigrationBookOfWorkService service;

    @Autowired
    private GeneratedMigrationBookOfWorkRepository repository;

    @Autowired
    private WorkItemRepository workItemRepository;

    @Autowired
    private MigrationStorySpecGenerationRepository specGenerationRepository;

    /** A draft whose one story is SAVED (a linked work_item row exists). */
    private SeededBook seedBookWithSavedStory(UUID projectId) {
        WorkItemEntity workItem = new WorkItemEntity();
        workItem.setId(UUID.randomUUID());
        workItem.setProjectId(projectId);
        workItem.setType("STORY");
        workItem.setStatus("PLANNED");
        workItem.setTitle("Recreate the nightly ledger close job");
        workItem.setDescription("Original description.");
        workItem = workItemRepository.save(workItem);

        Map<String, Object> story = new LinkedHashMap<>();
        story.put("id", "S1");
        story.put("type", "story");
        story.put("title", "Recreate the nightly ledger close job");
        story.put("description", "Original description.");
        story.put("acceptanceCriteria", List.of("The job runs at 02:00."));
        story.put("sequenceOrder", 1);
        story.put("workItemId", workItem.getId().toString());

        Map<String, Object> epic = new LinkedHashMap<>();
        epic.put("id", "E1");
        epic.put("type", "epic");
        epic.put("title", "An epic");
        epic.put("sequenceOrder", 0);

        Map<String, Object> bookOfWork = new LinkedHashMap<>();
        bookOfWork.put("items", List.of(epic, story));
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(projectId,
            new GeneratedMigrationBookOfWorkDto(
                null, null,
                UUID.randomUUID(), UUID.randomUUID(),
                null,
                "Saved plan", "A saved book of work.",
                null, null, null,
                bookOfWork,
                null, null, null, null, null));
        return new SeededBook(draft.id(), workItem.getId());
    }

    private record SeededBook(UUID bookId, UUID workItemId) {}

    @SuppressWarnings("unchecked")
    private Map<String, Object> reloadItem(UUID bookId, String itemId) {
        Map<String, Object> bookOfWork =
            repository.findById(bookId).orElseThrow().getBookOfWorkJson();
        List<Map<String, Object>> items =
            (List<Map<String, Object>>) bookOfWork.get("items");
        return items.stream()
            .filter(it -> itemId.equals(it.get("id")))
            .findFirst().orElse(null);
    }

    @Test
    @DisplayName("cite-finding adds the id to discoveryFindingReferences and a second cite is an idempotent no-op")
    void citeFinding_addsReference_idempotent() {
        UUID projectId = UUID.randomUUID();
        SeededBook book = seedBookWithSavedStory(projectId);
        String findingId = UUID.randomUUID().toString();

        CiteFindingResponse first = service.citeFindingOnItem(
            projectId, book.bookId(), "S1", new CiteFindingRequest(findingId));
        assertThat(first.alreadyCited()).isFalse();
        assertThat(reloadItem(book.bookId(), "S1").get("discoveryFindingReferences"))
            .as("the finding id lands in the D4 gate's citation array")
            .isEqualTo(List.of(findingId));

        CiteFindingResponse second = service.citeFindingOnItem(
            projectId, book.bookId(), "S1", new CiteFindingRequest(findingId));
        assertThat(second.alreadyCited()).isTrue();
        assertThat(reloadItem(book.bookId(), "S1").get("discoveryFindingReferences"))
            .as("idempotent: no duplicate reference")
            .isEqualTo(List.of(findingId));
    }

    @Test
    @DisplayName("amend replaces the description, APPENDS criteria, cites the finding, mirrors work_item.description, and marks the spec row STALE")
    void amend_appliesAllFourEffectsAtomically() {
        UUID projectId = UUID.randomUUID();
        SeededBook book = seedBookWithSavedStory(projectId);
        String findingId = UUID.randomUUID().toString();

        // A previously-generated spec for the story — the amend must invalidate it.
        MigrationStorySpecGenerationEntity spec = MigrationStorySpecGenerationEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .workItemId(book.workItemId())
            .bookOfWorkId(book.bookId())
            .bookItemId("S1")
            .status("generated")
            .generatedSpecText("the old spec text")
            .build();
        specGenerationRepository.save(spec);

        AmendBookItemResponse response = service.amendStoryItem(
            projectId, book.bookId(), "S1",
            new AmendBookItemRequest(
                "Amended description folding in the finding's replication-lag behaviour.",
                List.of("The close job halts when replication lag exceeds 5 minutes.", "  "),
                findingId,
                null));

        assertThat(response.specsMarkedStale()).isEqualTo(1);
        assertThat(response.workItemId()).isEqualTo(book.workItemId().toString());

        Map<String, Object> item = reloadItem(book.bookId(), "S1");
        assertThat(item.get("description"))
            .isEqualTo("Amended description folding in the finding's replication-lag behaviour.");
        assertThat(item.get("acceptanceCriteria"))
            .as("criteria are APPENDED, never replaced")
            .isEqualTo(List.of(
                "The job runs at 02:00.",
                "The close job halts when replication lag exceeds 5 minutes."));
        assertThat(item.get("discoveryFindingReferences")).isEqualTo(List.of(findingId));

        // The linked work_item mirrors the amended description.
        assertThat(workItemRepository.findById(book.workItemId()).orElseThrow().getDescription())
            .isEqualTo("Amended description folding in the finding's replication-lag behaviour.");

        // The spec row carries the FULL stale stamp — isStorySpecReady fails on
        // a non-null stale_reason, so the story drops out of stage readiness.
        MigrationStorySpecGenerationEntity reloaded =
            specGenerationRepository.findById(spec.getId()).orElseThrow();
        assertThat(reloaded.getStale()).isTrue();
        assertThat(reloaded.getStaleReason())
            .isEqualTo("story_amended_for_finding:" + findingId);
        assertThat(reloaded.getStaleMarkedAt()).isNotNull();

        // And the DTO wire EXPOSES the stamp (2026-07-26): the columns existed
        // but were never on the wire, so the gateway gate / plan screen could
        // not see staleness — this pin keeps the exposure honest.
        com.example.architecturemodel.model.dto.MigrationStorySpecGenerationDto wire =
            com.example.architecturemodel.mapper.MigrationStorySpecGenerationMapper
                .toDto(reloaded);
        assertThat(wire.stale()).isTrue();
        assertThat(wire.staleReason())
            .isEqualTo("story_amended_for_finding:" + findingId);
    }

    @Test
    @DisplayName("amend on a story with NO spec rows succeeds with specs_marked_stale=0")
    void amend_noSpecRows_succeedsWithZeroMarked() {
        UUID projectId = UUID.randomUUID();
        SeededBook book = seedBookWithSavedStory(projectId);

        AmendBookItemResponse response = service.amendStoryItem(
            projectId, book.bookId(), "S1",
            new AmendBookItemRequest(null, List.of("A new criterion."), null, null));

        assertThat(response.specsMarkedStale()).isZero();
        assertThat(reloadItem(book.bookId(), "S1").get("acceptanceCriteria"))
            .isEqualTo(List.of("The job runs at 02:00.", "A new criterion."));
    }

    @Test
    @DisplayName("add-item stamps workstream + acceptanceCriteria + discoveryFindingReferences (the NEW-STORY citation path)")
    void addItem_stampsTriageEraFields() {
        UUID projectId = UUID.randomUUID();
        SeededBook book = seedBookWithSavedStory(projectId);
        String findingId = UUID.randomUUID().toString();

        AddWorkItemResponse response = service.addItem(projectId, book.bookId(),
            new AddWorkItemRequest(
                WorkItemEntity.PROVENANCE_CARRY_OVER,
                AddWorkItemRequest.KIND_OPERATIONAL,
                "Recreate the archive purge job",
                "The current system purges archived rows weekly; the target must too.",
                null,
                5,
                null,
                "internal_processing_implementation",
                List.of("Purge runs weekly and logs row counts.", ""),
                List.of(findingId)));

        Map<String, Object> blob = reloadItem(book.bookId(), response.bookItemId());
        assertThat(blob.get("workstream")).isEqualTo("internal_processing_implementation");
        assertThat(blob.get("acceptanceCriteria"))
            .isEqualTo(List.of("Purge runs weekly and logs row counts."));
        assertThat(blob.get("discoveryFindingReferences"))
            .as("the explicit reference flips the originating finding to cited-by-story")
            .isEqualTo(List.of(findingId));
    }

    @Test
    @DisplayName("cite-finding on a non-story item and an amendment with nothing to apply are rejected 400")
    void guards_nonStoryAndEmptyAmend() {
        UUID projectId = UUID.randomUUID();
        SeededBook book = seedBookWithSavedStory(projectId);

        assertThatThrownBy(() -> service.citeFindingOnItem(
            projectId, book.bookId(), "E1",
            new CiteFindingRequest(UUID.randomUUID().toString())))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("STORY");

        assertThatThrownBy(() -> service.amendStoryItem(
            projectId, book.bookId(), "S1",
            new AmendBookItemRequest(null, List.of(), null, null)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("amendment");
    }
}
