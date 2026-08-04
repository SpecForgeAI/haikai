package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.DbGapProposalDto;
import com.example.architecturemodel.model.dto.UpdateDbGapProposalRequest;
import com.example.architecturemodel.model.dto.UpsertDbGapProposalsRequest;
import com.example.architecturemodel.model.entity.DbGapProposalEntity;
import com.example.architecturemodel.repository.entity.DbGapProposalRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

/**
 * Focused service-layer tests for the DB gap-proposal QUEUE stack -- Spec 4
 * (LLM gap-proposal queue). The changeset-apply checks live in
 * {@code DbGapProposalChangesetTest}.
 *
 * <p>Same {@code @DataJpaTest} + H2 JSONB-domain-aliased setup as
 * {@link DbStructuralFindingDispositionServiceTest}, with an {@code @Import}
 * of the service-under-test (project-scoped rows -- no owning-pack fixture
 * needed by design: proposals survive pack regeneration).</p>
 *
 * <p>Coverage:</p>
 * <ol>
 *   <li>(a) bulk upsert CREATES + read-back round trip (snake_case wire,
 *       payload_json jsonb intact, origin default llm, unreviewed).</li>
 *   <li>(b) re-upsert REFRESHES an unreviewed row (same id, payload /
 *       rationale / confidence updated) but NEVER mutates an approved row
 *       (human state verbatim, still returned).</li>
 *   <li>(c) PATCH review_status stamps reviewed_at; PATCH applied_at
 *       persists; unknown id -&gt; 404 semantics.</li>
 *   <li>(d) validation: invalid kind/origin/confidence, blank/duplicate
 *       proposal_key, missing payload_json/finding_key.</li>
 *   <li>(e) list filters by finding_key; project isolation; delete
 *       204/404 semantics.</li>
 * </ol>
 *
 * <p>Timestamps: the DB column stores microsecond precision (rounded) vs the
 * JVM's nanosecond Instants -- round-tripped timestamps are asserted with
 * {@code isCloseTo} within 1ms, never exact equality.</p>
 *
 * <p>Spec: LLM gap-proposal queue (2026-08-04) -- Spec 4.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:dbgapproposaldb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
@Import(DbGapProposalService.class)
class DbGapProposalServiceTest {

    private static final String KEY_FK_ORDERS = "fk--rel-orders-customers";
    private static final String KEY_PK_ORDERS = "pk--dbo.orders";
    private static final String FINDING_NO_FKS = "no_foreign_keys:dbo.orders";
    private static final String FINDING_NO_PKS = "no_primary_keys:all_tables";

    @Autowired
    private DbGapProposalService service;

    @Autowired
    private DbGapProposalRepository repository;

    @Autowired
    private TestEntityManager entityManager;

    // -----------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------

    private static Map<String, Object> fkPayload(String relationshipId) {
        return Map.of(
            "relationship_id", relationshipId,
            "from_table", "dbo.orders",
            "join_columns", List.of("customer_id"),
            "to_table", "dbo.customers",
            "referenced_columns", List.of("id"));
    }

    private static Map<String, Object> pkPayload() {
        return Map.of(
            "table", "dbo.orders",
            "entity_id", "entity-orders",
            "columns", List.of("order_id"));
    }

    private static UpsertDbGapProposalsRequest.Proposal item(
        String proposalKey, String findingKey, String kind,
        Map<String, Object> payload, String rationale, String confidence,
        String origin) {
        return new UpsertDbGapProposalsRequest.Proposal(
            proposalKey, findingKey, kind, payload, rationale, confidence, origin);
    }

    private static UpsertDbGapProposalsRequest batch(
        UpsertDbGapProposalsRequest.Proposal... proposals) {
        return new UpsertDbGapProposalsRequest(List.of(proposals));
    }

    // -----------------------------------------------------------------
    // Tests
    // -----------------------------------------------------------------

    @Test
    @DisplayName("(a) bulk upsert creates + read-back round trip: snake_case wire, payload_json jsonb intact, origin defaults llm, unreviewed")
    void bulkUpsertCreatesAndReadsBack() throws Exception {
        UUID projectId = UUID.randomUUID();

        List<DbGapProposalDto> created = service.bulkUpsert(projectId, batch(
            item(KEY_FK_ORDERS, FINDING_NO_FKS, "fk_join",
                fkPayload("rel-orders-customers"),
                "join column names + types line up", "high", null),
            item(KEY_PK_ORDERS, FINDING_NO_PKS, "primary_key",
                pkPayload(), null, "medium", "manual")));
        entityManager.flush();
        entityManager.clear();

        assertThat(created).hasSize(2);
        DbGapProposalDto fk = created.get(0);
        assertThat(fk.id()).isNotNull();
        assertThat(fk.projectId()).isEqualTo(projectId);
        assertThat(fk.proposalKey()).isEqualTo(KEY_FK_ORDERS);
        assertThat(fk.findingKey()).isEqualTo(FINDING_NO_FKS);
        assertThat(fk.kind()).isEqualTo("fk_join");
        assertThat(fk.rationale()).contains("line up");
        assertThat(fk.confidence()).isEqualTo("high");
        assertThat(fk.origin()).as("origin defaults to llm").isEqualTo("llm");
        assertThat(fk.reviewStatus()).as("created unreviewed").isEqualTo("unreviewed");
        assertThat(fk.appliedAt()).isNull();
        assertThat(fk.createdAt()).isNotNull();
        assertThat(fk.reviewedAt()).isNull();
        assertThat(created.get(1).origin()).as("explicit origin honoured")
            .isEqualTo("manual");

        // Reload: the jsonb payload survives the round trip intact.
        List<DbGapProposalDto> listed = service.listByProject(projectId, null);
        assertThat(listed).hasSize(2);
        DbGapProposalDto reloadedFk = listed.stream()
            .filter(p -> KEY_FK_ORDERS.equals(p.proposalKey())).findFirst().orElseThrow();
        assertThat(reloadedFk.payloadJson())
            .containsEntry("relationship_id", "rel-orders-customers")
            .containsEntry("from_table", "dbo.orders")
            .containsEntry("to_table", "dbo.customers");
        assertThat(reloadedFk.payloadJson().get("join_columns"))
            .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.LIST)
            .containsExactly("customer_id");

        // Snake_case wire: a vanilla ObjectMapper honours the explicit
        // @JsonProperty declarations on the record.
        String json = new ObjectMapper().writeValueAsString(reloadedFk);
        assertThat(json).contains("\"project_id\"");
        assertThat(json).contains("\"proposal_key\"");
        assertThat(json).contains("\"finding_key\"");
        assertThat(json).contains("\"payload_json\"");
        assertThat(json).contains("\"review_status\"");
        assertThat(json).contains("\"applied_at\"");
        assertThat(json).doesNotContain("\"proposalKey\"");
        assertThat(json).doesNotContain("\"reviewStatus\"");
    }

    @Test
    @DisplayName("(b) re-upsert refreshes an UNREVIEWED row (same id) but NEVER mutates an approved row (human state verbatim, still returned)")
    void reUpsertRefreshesUnreviewedButNeverApproved() {
        UUID projectId = UUID.randomUUID();

        List<DbGapProposalDto> created = service.bulkUpsert(projectId, batch(
            item(KEY_FK_ORDERS, FINDING_NO_FKS, "fk_join",
                fkPayload("rel-v1"), "first guess", "low", null),
            item(KEY_PK_ORDERS, FINDING_NO_PKS, "primary_key",
                pkPayload(), "pk guess", "medium", null)));
        entityManager.flush();
        entityManager.clear();
        UUID fkId = created.get(0).id();
        UUID pkId = created.get(1).id();

        // Approve the PK proposal -- it becomes human state.
        service.patch(projectId, pkId,
            new UpdateDbGapProposalRequest("approved", "looks right", null));
        entityManager.flush();
        entityManager.clear();

        // Regeneration-shaped re-upsert of BOTH keys with new content.
        List<DbGapProposalDto> upserted = service.bulkUpsert(projectId, batch(
            item(KEY_FK_ORDERS, FINDING_NO_FKS, "fk_join",
                fkPayload("rel-v2"), "better guess", "high", null),
            item(KEY_PK_ORDERS, FINDING_NO_PKS, "primary_key",
                Map.of("table", "dbo.orders", "entity_id", "entity-orders",
                    "columns", List.of("SHOULD_NOT_LAND")),
                "SHOULD_NOT_LAND", "low", null)));
        entityManager.flush();
        entityManager.clear();

        // Unreviewed FK row: refreshed IN PLACE (same id, new content).
        DbGapProposalDto refreshedFk = upserted.get(0);
        assertThat(refreshedFk.id()).as("re-link, never duplicate").isEqualTo(fkId);
        assertThat(refreshedFk.payloadJson()).containsEntry("relationship_id", "rel-v2");
        assertThat(refreshedFk.rationale()).isEqualTo("better guess");
        assertThat(refreshedFk.confidence()).isEqualTo("high");
        assertThat(refreshedFk.reviewStatus()).isEqualTo("unreviewed");
        assertThat(Instant.parse(refreshedFk.createdAt()))
            .isCloseTo(Instant.parse(created.get(0).createdAt()),
                within(1, ChronoUnit.MILLIS));

        // Approved PK row: VERBATIM (human state), but still returned.
        DbGapProposalDto preservedPk = upserted.get(1);
        assertThat(preservedPk.id()).isEqualTo(pkId);
        assertThat(preservedPk.reviewStatus()).isEqualTo("approved");
        assertThat(preservedPk.rationale()).as("approved content untouched")
            .isEqualTo("pk guess");
        assertThat(preservedPk.confidence()).isEqualTo("medium");
        assertThat(preservedPk.payloadJson().get("columns"))
            .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.LIST)
            .containsExactly("order_id");
        assertThat(preservedPk.reviewerNotes()).isEqualTo("looks right");

        // The DB agrees: still exactly 2 rows, approved one untouched.
        List<DbGapProposalEntity> rows =
            repository.findByProjectIdOrderByCreatedAtAsc(projectId);
        assertThat(rows).hasSize(2);
        DbGapProposalEntity pkRow = rows.stream()
            .filter(r -> KEY_PK_ORDERS.equals(r.getProposalKey()))
            .findFirst().orElseThrow();
        assertThat(pkRow.getRationale()).isEqualTo("pk guess");
        assertThat(pkRow.getPayloadJson().get("columns"))
            .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.LIST)
            .containsExactly("order_id");
    }

    @Test
    @DisplayName("(c) PATCH: review_status stamps reviewed_at, applied_at persists, sparse fields untouched, unknown id -> 404 semantics, bad enum -> 400")
    void patchReviewAndAppliedAt() {
        UUID projectId = UUID.randomUUID();

        DbGapProposalDto created = service.bulkUpsert(projectId, batch(
            item(KEY_FK_ORDERS, FINDING_NO_FKS, "fk_join",
                fkPayload("rel-v1"), "guess", "high", null))).get(0);
        entityManager.flush();
        entityManager.clear();

        // Review PATCH stamps reviewed_at; untouched fields survive.
        DbGapProposalDto reviewed = service.patch(projectId, created.id(),
            new UpdateDbGapProposalRequest("needs_rework", "columns look off", null));
        assertThat(reviewed.reviewStatus()).isEqualTo("needs_rework");
        assertThat(reviewed.reviewerNotes()).isEqualTo("columns look off");
        assertThat(reviewed.reviewedAt()).as("review stamps reviewed_at").isNotNull();
        assertThat(reviewed.appliedAt()).isNull();
        assertThat(reviewed.rationale()).as("sparse: untouched").isEqualTo("guess");
        entityManager.flush();
        entityManager.clear();

        // applied_at PATCH persists (write-back stamp), review state untouched.
        Instant appliedStamp = Instant.parse("2026-08-04T10:15:30Z");
        DbGapProposalDto applied = service.patch(projectId, created.id(),
            new UpdateDbGapProposalRequest(null, null, appliedStamp.toString()));
        assertThat(applied.reviewStatus()).as("sparse: untouched")
            .isEqualTo("needs_rework");
        assertThat(applied.appliedAt()).isNotNull();
        assertThat(Instant.parse(applied.appliedAt()))
            .isCloseTo(appliedStamp, within(1, ChronoUnit.MILLIS));
        entityManager.flush();
        entityManager.clear();

        // Round trip: applied_at survives the DB.
        DbGapProposalDto reloaded = service.listByProject(projectId, null).get(0);
        assertThat(reloaded.appliedAt()).isNotNull();
        assertThat(Instant.parse(reloaded.appliedAt()))
            .isCloseTo(appliedStamp, within(1, ChronoUnit.MILLIS));

        // Invalid review_status -> 400 semantics.
        assertThatThrownBy(() -> service.patch(projectId, created.id(),
            new UpdateDbGapProposalRequest("shrugged", null, null)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid review_status");

        // Unparseable applied_at -> 400 semantics.
        assertThatThrownBy(() -> service.patch(projectId, created.id(),
            new UpdateDbGapProposalRequest(null, null, "yesterday-ish")))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("applied_at");

        // Unknown id / wrong project -> 404 semantics.
        assertThatThrownBy(() -> service.patch(projectId, UUID.randomUUID(),
            new UpdateDbGapProposalRequest("approved", null, null)))
            .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.patch(UUID.randomUUID(), created.id(),
            new UpdateDbGapProposalRequest("approved", null, null)))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    @DisplayName("(d) validation: invalid kind/origin/confidence, blank/duplicate proposal_key, missing payload_json/finding_key")
    void bulkUpsertValidation() {
        UUID projectId = UUID.randomUUID();

        // Invalid kind rejects.
        assertThatThrownBy(() -> service.bulkUpsert(projectId, batch(
            item(KEY_FK_ORDERS, FINDING_NO_FKS, "index",
                fkPayload("rel-v1"), null, null, null))))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid kind");

        // Invalid origin rejects.
        assertThatThrownBy(() -> service.bulkUpsert(projectId, batch(
            item(KEY_FK_ORDERS, FINDING_NO_FKS, "fk_join",
                fkPayload("rel-v1"), null, null, "oracle"))))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid origin");

        // Invalid confidence rejects.
        assertThatThrownBy(() -> service.bulkUpsert(projectId, batch(
            item(KEY_FK_ORDERS, FINDING_NO_FKS, "fk_join",
                fkPayload("rel-v1"), null, "certain", null))))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid confidence");

        // Blank proposal_key rejects.
        assertThatThrownBy(() -> service.bulkUpsert(projectId, batch(
            item("  ", FINDING_NO_FKS, "fk_join", fkPayload("rel-v1"), null, null, null))))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("proposal_key is required");

        // Duplicate proposal_key in one batch rejects.
        assertThatThrownBy(() -> service.bulkUpsert(projectId, batch(
            item(KEY_FK_ORDERS, FINDING_NO_FKS, "fk_join",
                fkPayload("rel-v1"), null, null, null),
            item(KEY_FK_ORDERS, FINDING_NO_FKS, "fk_join",
                fkPayload("rel-v2"), null, null, null))))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("duplicate proposal_key");

        // Missing payload_json rejects.
        assertThatThrownBy(() -> service.bulkUpsert(projectId, batch(
            item(KEY_FK_ORDERS, FINDING_NO_FKS, "fk_join", null, null, null, null))))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("payload_json is required");

        // Missing finding_key rejects.
        assertThatThrownBy(() -> service.bulkUpsert(projectId, batch(
            item(KEY_FK_ORDERS, "  ", "fk_join", fkPayload("rel-v1"), null, null, null))))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("finding_key is required");

        // Empty batch rejects.
        assertThatThrownBy(() -> service.bulkUpsert(projectId,
            new UpsertDbGapProposalsRequest(List.of())))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("proposals is required");

        // Bad batches are all-or-nothing: nothing was persisted.
        assertThat(repository.findByProjectIdOrderByCreatedAtAsc(projectId)).isEmpty();
    }

    @Test
    @DisplayName("(e) list filters by finding_key + project isolation; delete removes, absent id -> 404 semantics")
    void listFilterAndDelete() {
        UUID projectA = UUID.randomUUID();
        UUID projectB = UUID.randomUUID();

        service.bulkUpsert(projectA, batch(
            item(KEY_FK_ORDERS, FINDING_NO_FKS, "fk_join",
                fkPayload("rel-a"), null, null, null),
            item(KEY_PK_ORDERS, FINDING_NO_PKS, "primary_key",
                pkPayload(), null, null, null)));
        // SAME proposal_key on a DIFFERENT project: independent row.
        List<DbGapProposalDto> inB = service.bulkUpsert(projectB, batch(
            item(KEY_FK_ORDERS, FINDING_NO_FKS, "fk_join",
                fkPayload("rel-b"), null, null, null)));
        entityManager.flush();
        entityManager.clear();

        // Unfiltered list: project A has both, oldest first.
        List<DbGapProposalDto> listedA = service.listByProject(projectA, null);
        assertThat(listedA).hasSize(2);
        assertThat(listedA)
            .extracting(DbGapProposalDto::proposalKey)
            .containsExactly(KEY_FK_ORDERS, KEY_PK_ORDERS);

        // finding_key filter narrows.
        List<DbGapProposalDto> fkOnly = service.listByProject(projectA, FINDING_NO_FKS);
        assertThat(fkOnly).hasSize(1);
        assertThat(fkOnly.get(0).proposalKey()).isEqualTo(KEY_FK_ORDERS);
        assertThat(service.listByProject(projectA, "nope:nothing")).isEmpty();

        // Project isolation.
        List<DbGapProposalDto> listedB = service.listByProject(projectB, null);
        assertThat(listedB).hasSize(1);
        assertThat(listedB.get(0).payloadJson()).containsEntry("relationship_id", "rel-b");
        assertThat(service.listByProject(UUID.randomUUID(), null)).isEmpty();

        // Delete removes; repeated / cross-project delete -> 404 semantics.
        UUID bId = inB.get(0).id();
        service.delete(projectB, bId);
        entityManager.flush();
        entityManager.clear();
        assertThat(service.listByProject(projectB, null)).isEmpty();
        assertThatThrownBy(() -> service.delete(projectB, bId))
            .isInstanceOf(ResourceNotFoundException.class);
        UUID aId = service.listByProject(projectA, null).get(0).id();
        assertThatThrownBy(() -> service.delete(projectB, aId))
            .as("wrong project never deletes another project's row")
            .isInstanceOf(ResourceNotFoundException.class);
        assertThat(service.listByProject(projectA, null)).hasSize(2);
    }
}
