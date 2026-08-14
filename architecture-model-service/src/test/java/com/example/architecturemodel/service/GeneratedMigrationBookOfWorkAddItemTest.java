package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.AddWorkItemRequest;
import com.example.architecturemodel.model.dto.AddWorkItemResponse;
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
 * D5 service-layer test: the {@code addItem} endpoint mints a MANUAL
 * {@code type='story'} WorkItem, stamps {@code provenance} on BOTH the
 * {@code work_item} COLUMN (changeset 186) and the {@code book_of_work_json}
 * blob, and the minted item is {@code selectEligibleStories}-eligible (blob
 * {@code type === 'story'} + non-null {@code workItemId}).
 *
 * <p>Spec: D5 -- Net-new backlog items + provenance (2026-06-14, Spec 5 of 6) --
 * Task Group 2. Uses the same JSONB-domain-aliased {@code @DataJpaTest} H2 harness
 * as the sibling {@code GeneratedMigrationBookOfWorkAppendCapabilityStoryColumnTest}
 * so {@code persistOne} writes a real {@code work_item} row (the provenance column
 * round-trips live here).</p>
 *
 * <p>Focused assertions (4 -- within the 2-8 budget per task 2.1):</p>
 * <ol>
 *   <li>a {@code net_new} add mints a {@code type='STORY'} work_item with
 *       {@code provenance='net_new'} on the COLUMN, and the blob item is
 *       eligible: {@code type === 'story'} + non-null {@code workItemId} +
 *       {@code provenance='net_new'};</li>
 *   <li>a {@code carry_over} add (the undiscoverable-carry_over case) stamps
 *       {@code carry_over} on the column + blob (both provenance values covered);</li>
 *   <li>the minted item carries NO {@code source_capability_id} (column null) and
 *       NO {@code source_capability_id} on the blob -- what keeps it OUT of D4's
 *       discovered must-account set with no gate code; AND</li>
 *   <li>an invalid provenance is rejected (service-layer validation; the column
 *       stays a plain VARCHAR).</li>
 * </ol>
 *
 * <p>Extended by Non-Reconciling Work at Reconcile Time (2026-06-14, Spec 6 of 6
 * / D6) -- Task Group 2: the add-item chain now also captures an optional
 * {@code net_new_operations} list ({@code <METHOD> <path>} strings) onto the blob
 * item, the AUTHORITATIVE human-owned match source the D6 reconcile-time
 * auto-disposition pass reads. It is stamped ONLY for {@code provenance=net_new}
 * + {@code kind=api}; a non-net_new or non-api add ignores it. Two trailing tests
 * cover this. NO new changeset -- it rides the blob like provenance/kind.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:gmbwadditemdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
@Import({
    GeneratedMigrationBookOfWorkService.class,
    GeneratedMigrationBookOfWorkService.GeneratedMigrationBookOfWorkItemSaver.class
})
class GeneratedMigrationBookOfWorkAddItemTest {

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
    @DisplayName("addItem mints a type='story' WorkItem, stamps net_new on the COLUMN, and the blob item is selectEligibleStories-eligible")
    void addItem_netNew_mintsEligibleStoryWithProvenanceColumnAndBlob() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(projectId, buildSavedDraft());

        AddWorkItemRequest request = new AddWorkItemRequest(
            WorkItemEntity.PROVENANCE_NET_NEW,
            AddWorkItemRequest.KIND_API,
            "Add a brand-new fraud-score endpoint",
            "Expose POST /fraud-score returning a risk band for a transaction.",
            null,
            2,
            null);

        AddWorkItemResponse response = service.addItem(projectId, draft.id(), request);

        // The minted work_item is a STORY (persistOne uppercases the type) carrying
        // provenance=net_new on the COLUMN (what D6's reconcile reads directly).
        WorkItemEntity created =
            workItemRepository.findById(response.workItemId()).orElseThrow();
        assertThat(created.getType()).isEqualTo("STORY");
        assertThat(created.getProvenance())
            .as("net_new must be stamped on the work_item.provenance COLUMN")
            .isEqualTo(WorkItemEntity.PROVENANCE_NET_NEW);

        // The blob item is selectEligibleStories-eligible: type === 'story'
        // (lowercase) + non-null workItemId, and carries provenance on the blob too.
        Map<String, Object> reloaded =
            repository.findById(draft.id()).orElseThrow().getBookOfWorkJson();
        Map<String, Object> blob = itemById(itemsOf(reloaded), response.bookItemId());
        assertThat(blob).isNotNull();
        assertThat(blob.get("type"))
            .as("blob type stays lowercase 'story' so selectEligibleStories consumes it")
            .isEqualTo("story");
        assertThat(blob.get("workItemId"))
            .as("eligibility requires a non-null workItemId on the blob")
            .isEqualTo(response.workItemId().toString());
        assertThat(blob.get("provenance"))
            .as("provenance rides the blob too (column + blob both carry it)")
            .isEqualTo(WorkItemEntity.PROVENANCE_NET_NEW);
        assertThat(blob.get("kind")).isEqualTo(AddWorkItemRequest.KIND_API);
        assertThat(response.provenance()).isEqualTo(WorkItemEntity.PROVENANCE_NET_NEW);
    }

    @Test
    @DisplayName("addItem stamps the OPTIONAL tags list verbatim onto the blob item (2026-08-14 — the saved-book scaffold mint's seed_build_files marker)")
    void addItem_stampsTagsOntoBlob() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(projectId, buildSavedDraft());

        AddWorkItemRequest request = new AddWorkItemRequest(
            WorkItemEntity.PROVENANCE_NET_NEW,
            AddWorkItemRequest.KIND_OPERATIONAL,
            "Scaffold the service app and reproduce pom.xml exactly as confirmed, dependency-for-dependency.",
            "Scaffold story.",
            null,
            0,
            null,
            "api_migration",
            null,
            null,
            java.util.List.of("seed_build_files", "stream:api_migration", "provenance:scaffold", "  ", ""));

        AddWorkItemResponse response = service.addItem(projectId, draft.id(), request);

        Map<String, Object> reloaded =
            repository.findById(draft.id()).orElseThrow().getBookOfWorkJson();
        Map<String, Object> blob = itemById(itemsOf(reloaded), response.bookItemId());
        assertThat(blob).isNotNull();
        // Tags ride the blob verbatim (blank entries dropped) — the downstream
        // deterministic bootstrap carriage recognises the story by this marker.
        assertThat(blob.get("tags")).isEqualTo(
            java.util.List.of("seed_build_files", "stream:api_migration", "provenance:scaffold"));
        assertThat(blob.get("workstream")).isEqualTo("api_migration");
    }

    @Test
    @DisplayName("addItem with carry_over (undiscoverable-carry_over case) stamps carry_over on the column + blob")
    void addItem_carryOver_stampsCarryOver() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(projectId, buildSavedDraft());

        // The OS-cron / vacuum-schedule case: like-for-like work no parser finds.
        AddWorkItemRequest request = new AddWorkItemRequest(
            WorkItemEntity.PROVENANCE_CARRY_OVER,
            AddWorkItemRequest.KIND_OPERATIONAL,
            "Nightly vacuum + reindex schedule",
            "Re-create the OS cron that vacuums and reindexes the ledger tables at 02:00.",
            null,
            3,
            null);

        AddWorkItemResponse response = service.addItem(projectId, draft.id(), request);

        WorkItemEntity created =
            workItemRepository.findById(response.workItemId()).orElseThrow();
        assertThat(created.getProvenance()).isEqualTo(WorkItemEntity.PROVENANCE_CARRY_OVER);

        Map<String, Object> reloaded =
            repository.findById(draft.id()).orElseThrow().getBookOfWorkJson();
        Map<String, Object> blob = itemById(itemsOf(reloaded), response.bookItemId());
        assertThat(blob.get("provenance")).isEqualTo(WorkItemEntity.PROVENANCE_CARRY_OVER);
        // operational kind rides the blob so the gateway can flavour the prompt.
        assertThat(blob.get("kind")).isEqualTo(AddWorkItemRequest.KIND_OPERATIONAL);
    }

    @Test
    @DisplayName("addItem carries NO source_capability_id on the column or blob (keeps it OUT of D4's discovered must-account set)")
    void addItem_carriesNoSourceCapabilityId() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(projectId, buildSavedDraft());

        AddWorkItemResponse response = service.addItem(projectId, draft.id(),
            new AddWorkItemRequest(
                WorkItemEntity.PROVENANCE_NET_NEW, AddWorkItemRequest.KIND_API,
                "A manual add", "desc", null, 2, null));

        // A manual add has NO discovered capability -> column stays null, so the
        // D4 cited-capability finder never returns it (no gate code needed).
        WorkItemEntity created =
            workItemRepository.findById(response.workItemId()).orElseThrow();
        assertThat(created.getSourceCapabilityId())
            .as("a manual add carries NO source_capability_id on the COLUMN")
            .isNull();
        assertThat(workItemRepository.findByProjectIdAndSourceCapabilityIdIsNotNull(projectId))
            .as("the manual add is never in the D4 cited-capability must-account set")
            .isEmpty();

        // The blob also carries no source_capability_id / finding refs.
        Map<String, Object> reloaded =
            repository.findById(draft.id()).orElseThrow().getBookOfWorkJson();
        Map<String, Object> blob = itemById(itemsOf(reloaded), response.bookItemId());
        assertThat(blob).doesNotContainKey("source_capability_id");
        assertThat(blob).doesNotContainKey("discoveryFindingReferences");
    }

    @Test
    @DisplayName("addItem rejects an invalid provenance with 400 (service-layer validation)")
    void addItem_invalidProvenance_rejected() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(projectId, buildSavedDraft());

        assertThatThrownBy(() -> service.addItem(projectId, draft.id(),
            new AddWorkItemRequest(
                "bogus_value", AddWorkItemRequest.KIND_API, "A manual add", "desc", null, 1, null)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("provenance");
    }

    // -----------------------------------------------------------------
    // D6 -- net_new_operations capture (Spec 6 of 6 -- Task Group 2)
    // -----------------------------------------------------------------

    @Test
    @DisplayName("D6: a net_new + api add stamps the net_new_operations list (trimmed, de-duped) onto the blob item")
    void addItem_netNewApi_stampsNetNewOperationsOnBlob() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(projectId, buildSavedDraft());

        // The explicit, human-owned operation list (one <METHOD> <path> per entry),
        // with a blank + a duplicate to prove the sanitiser trims/drops blanks and
        // de-dupes while preserving order.
        AddWorkItemRequest request = new AddWorkItemRequest(
            WorkItemEntity.PROVENANCE_NET_NEW,
            AddWorkItemRequest.KIND_API,
            "Add a brand-new accounts endpoint",
            "Expose POST /accounts to open a new account.",
            null,
            2,
            List.of("POST /accounts", "  ", "GET /accounts/{id}", "POST /accounts"));

        AddWorkItemResponse response = service.addItem(projectId, draft.id(), request);

        Map<String, Object> reloaded =
            repository.findById(draft.id()).orElseThrow().getBookOfWorkJson();
        Map<String, Object> blob = itemById(itemsOf(reloaded), response.bookItemId());
        assertThat(blob).isNotNull();
        Object stamped = blob.get("net_new_operations");
        assertThat(stamped)
            .as("net_new + api add must stamp the net_new_operations list onto the blob")
            .isInstanceOf(List.class);
        @SuppressWarnings("unchecked")
        List<String> ops = (List<String>) stamped;
        // Blank dropped + duplicate collapsed; order preserved (POST /accounts first).
        assertThat(ops).containsExactly("POST /accounts", "GET /accounts/{id}");
    }

    @Test
    @DisplayName("D6: a non-net_new (carry_over) add does NOT stamp net_new_operations even when supplied (scoped to net_new + api only)")
    void addItem_nonNetNew_ignoresNetNewOperations() {
        UUID projectId = UUID.randomUUID();
        GeneratedMigrationBookOfWorkDto draft = service.createDraft(projectId, buildSavedDraft());

        // A carry_over add that (wrongly) supplies operations -- they must be ignored.
        AddWorkItemRequest carryOver = new AddWorkItemRequest(
            WorkItemEntity.PROVENANCE_CARRY_OVER,
            AddWorkItemRequest.KIND_API,
            "An undiscoverable carry_over add",
            "desc",
            null,
            2,
            List.of("POST /accounts"));

        AddWorkItemResponse carryResp = service.addItem(projectId, draft.id(), carryOver);
        Map<String, Object> carryReloaded =
            repository.findById(draft.id()).orElseThrow().getBookOfWorkJson();
        Map<String, Object> carryBlob = itemById(itemsOf(carryReloaded), carryResp.bookItemId());
        assertThat(carryBlob)
            .as("a non-net_new add never stamps net_new_operations (scoped to net_new + api)")
            .doesNotContainKey("net_new_operations");

        // And a net_new + OPERATIONAL add likewise does not stamp (api-only).
        AddWorkItemRequest netNewOperational = new AddWorkItemRequest(
            WorkItemEntity.PROVENANCE_NET_NEW,
            AddWorkItemRequest.KIND_OPERATIONAL,
            "A net_new operational job",
            "desc",
            null,
            3,
            List.of("POST /accounts"));

        AddWorkItemResponse opResp = service.addItem(projectId, draft.id(), netNewOperational);
        Map<String, Object> opReloaded =
            repository.findById(draft.id()).orElseThrow().getBookOfWorkJson();
        Map<String, Object> opBlob = itemById(itemsOf(opReloaded), opResp.bookItemId());
        assertThat(opBlob)
            .as("a net_new but non-api (operational) add does not stamp net_new_operations")
            .doesNotContainKey("net_new_operations");
    }
}
