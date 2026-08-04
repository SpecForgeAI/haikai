package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.DbStructuralFindingDispositionDto;
import com.example.architecturemodel.model.dto.UpsertDbStructuralFindingDispositionRequest;
import com.example.architecturemodel.model.entity.DbStructuralFindingDispositionEntity;
import com.example.architecturemodel.repository.entity.DbStructuralFindingDispositionRepository;
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

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Focused service-layer tests for the DB structural-finding DISPOSITIONS
 * stack -- Spec 2 (Structural findings dispositions). The changeset-apply
 * checks live in
 * {@code DbStructuralFindingDispositionChangesetTest}.
 *
 * <p>Same {@code @DataJpaTest} + H2 setup as
 * {@link DbMigrationPackTranslationServiceTest}, with an {@code @Import} of
 * the service-under-test (project-scoped rows -- no owning-pack fixture
 * needed by design: dispositions survive pack regeneration).</p>
 *
 * <p>Coverage:</p>
 * <ol>
 *   <li>(a) upsert CREATES + read-back round trip (snake_case wire).</li>
 *   <li>(b) upsert of an existing key UPDATES sparsely (same id, omitted
 *       fields untouched, updated_at stamped) -- the regeneration-survival
 *       property.</li>
 *   <li>(c) validation: invalid disposition, accepted/known_gap without a
 *       note (create AND post-merge), missing kind/subject/disposition on
 *       create.</li>
 *   <li>(d) list-by-project isolation across projects.</li>
 *   <li>(e) delete removes (un-disposition); absent key -&gt; 404
 *       semantics.</li>
 * </ol>
 *
 * <p>Spec: Structural findings dispositions (2026-08-04) -- Spec 2.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:dbstructfindingdispdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
@Import(DbStructuralFindingDispositionService.class)
class DbStructuralFindingDispositionServiceTest {

    private static final String KEY_NO_PKS = "no_primary_keys:all_tables";
    private static final String KEY_NO_FKS = "no_foreign_keys:dbo.orders";

    @Autowired
    private DbStructuralFindingDispositionService service;

    @Autowired
    private DbStructuralFindingDispositionRepository repository;

    @Autowired
    private TestEntityManager entityManager;

    private static UpsertDbStructuralFindingDispositionRequest req(
        String disposition, String note, String kind, String subject) {
        return new UpsertDbStructuralFindingDispositionRequest(
            disposition, note, kind, subject);
    }

    // -----------------------------------------------------------------
    // Tests
    // -----------------------------------------------------------------

    @Test
    @DisplayName("(a) upsert creates + read-back round trip: snake_case wire, created_at stamped, updated_at null")
    void upsertCreatesAndReadsBack() throws Exception {
        UUID projectId = UUID.randomUUID();

        DbStructuralFindingDispositionDto created = service.upsert(
            projectId, KEY_NO_PKS,
            req("accepted", "legacy schema never had PKs; app enforces identity",
                "no_primary_keys", "all_tables"));
        assertThat(created.id()).isNotNull();
        assertThat(created.projectId()).isEqualTo(projectId);
        assertThat(created.findingKey()).isEqualTo(KEY_NO_PKS);
        assertThat(created.kind()).isEqualTo("no_primary_keys");
        assertThat(created.subject()).isEqualTo("all_tables");
        assertThat(created.disposition()).isEqualTo("accepted");
        assertThat(created.note()).contains("legacy schema");
        assertThat(created.createdAt()).isNotNull();
        assertThat(created.updatedAt()).as("never updated yet").isNull();
        entityManager.flush();
        entityManager.clear();

        List<DbStructuralFindingDispositionDto> listed = service.listByProject(projectId);
        assertThat(listed).hasSize(1);

        // Snake_case wire: a vanilla ObjectMapper honours the explicit
        // @JsonProperty declarations on the record.
        String json = new ObjectMapper().writeValueAsString(listed.get(0));
        assertThat(json).contains("\"project_id\"");
        assertThat(json).contains("\"finding_key\"");
        assertThat(json).contains("\"created_at\"");
        assertThat(json).contains("\"updated_at\"");
        assertThat(json).doesNotContain("\"projectId\"");
        assertThat(json).doesNotContain("\"findingKey\"");
    }

    @Test
    @DisplayName("(b) upsert of an existing key updates SPARSELY: same id, omitted fields untouched, updated_at stamped")
    void upsertUpdatesSparsely() {
        UUID projectId = UUID.randomUUID();

        DbStructuralFindingDispositionDto original = service.upsert(
            projectId, KEY_NO_PKS,
            req("known_gap", "PKs unknowable from the capture; tracked in backlog",
                "no_primary_keys", "all_tables"));
        entityManager.flush();
        entityManager.clear();

        // Regeneration-shaped re-upsert: disposition ONLY (kind / subject /
        // note omitted) -- the sparse merge leaves them verbatim.
        DbStructuralFindingDispositionDto updated = service.upsert(
            projectId, KEY_NO_PKS,
            req("fix_upstream", null, null, null));
        entityManager.flush();
        entityManager.clear();

        assertThat(updated.id()).as("re-link, never duplicate").isEqualTo(original.id());
        assertThat(updated.disposition()).isEqualTo("fix_upstream");
        assertThat(updated.kind()).as("omitted field untouched").isEqualTo("no_primary_keys");
        assertThat(updated.subject()).as("omitted field untouched").isEqualTo("all_tables");
        assertThat(updated.note()).as("omitted field untouched")
            .contains("tracked in backlog");
        // The DB column stores microsecond precision (rounded); the pre-flush
        // DTO carries the JVM's nanosecond Instant — compare with a 1ms
        // tolerance rather than exact string equality.
        assertThat(java.time.Instant.parse(updated.createdAt()))
            .isCloseTo(java.time.Instant.parse(original.createdAt()),
                org.assertj.core.api.Assertions.within(1, java.time.temporal.ChronoUnit.MILLIS));
        assertThat(updated.updatedAt()).as("update stamps updated_at").isNotNull();

        // Exactly one row persists for the key.
        List<DbStructuralFindingDispositionEntity> rows =
            repository.findByProjectIdOrderByCreatedAtAsc(projectId);
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getFindingKey()).isEqualTo(KEY_NO_PKS);

        // Flipping back to a note-requiring disposition succeeds because the
        // preserved note satisfies the EFFECTIVE (post-merge) rule.
        DbStructuralFindingDispositionDto flippedBack = service.upsert(
            projectId, KEY_NO_PKS, req("known_gap", null, null, null));
        assertThat(flippedBack.disposition()).isEqualTo("known_gap");
        assertThat(flippedBack.note()).contains("tracked in backlog");
    }

    @Test
    @DisplayName("(c) validation: invalid disposition, note required for accepted/known_gap, kind/subject/disposition required on create")
    void validationRules() {
        UUID projectId = UUID.randomUUID();

        // Invalid disposition rejects.
        assertThatThrownBy(() -> service.upsert(projectId, KEY_NO_PKS,
            req("shrugged", null, "no_primary_keys", "all_tables")))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid disposition");

        // accepted without a note rejects (create path).
        assertThatThrownBy(() -> service.upsert(projectId, KEY_NO_PKS,
            req("accepted", null, "no_primary_keys", "all_tables")))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("note is required");

        // known_gap with a BLANK note rejects (blank never satisfies).
        assertThatThrownBy(() -> service.upsert(projectId, KEY_NO_PKS,
            req("known_gap", "   ", "no_primary_keys", "all_tables")))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("note is required");

        // fix_upstream needs no note.
        assertThat(service.upsert(projectId, KEY_NO_PKS,
            req("fix_upstream", null, "no_primary_keys", "all_tables"))
            .disposition()).isEqualTo("fix_upstream");

        // Post-merge rule: flipping an existing no-note row to accepted
        // WITHOUT supplying a note rejects (effective state has no note).
        assertThatThrownBy(() -> service.upsert(projectId, KEY_NO_PKS,
            req("accepted", null, null, null)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("note is required");

        // Create-path identity requirements: disposition / kind / subject.
        assertThatThrownBy(() -> service.upsert(projectId, KEY_NO_FKS,
            req(null, null, "no_foreign_keys", "dbo.orders")))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("disposition is required");
        assertThatThrownBy(() -> service.upsert(projectId, KEY_NO_FKS,
            req("fix_upstream", null, null, "dbo.orders")))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("kind is required");
        assertThatThrownBy(() -> service.upsert(projectId, KEY_NO_FKS,
            req("fix_upstream", null, "no_foreign_keys", "  ")))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("subject is required");

        // Blank finding key rejects.
        assertThatThrownBy(() -> service.upsert(projectId, "  ",
            req("fix_upstream", null, "k", "s")))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("finding_key is required");
    }

    @Test
    @DisplayName("(d) list-by-project returns only that project's rows, oldest first")
    void listByProjectIsolation() {
        UUID projectA = UUID.randomUUID();
        UUID projectB = UUID.randomUUID();

        service.upsert(projectA, KEY_NO_PKS,
            req("accepted", "fine as is", "no_primary_keys", "all_tables"));
        service.upsert(projectA, KEY_NO_FKS,
            req("fix_upstream", null, "no_foreign_keys", "dbo.orders"));
        // SAME finding_key on a DIFFERENT project: independent row.
        service.upsert(projectB, KEY_NO_PKS,
            req("known_gap", "different project, different call",
                "no_primary_keys", "all_tables"));
        entityManager.flush();
        entityManager.clear();

        List<DbStructuralFindingDispositionDto> listedA = service.listByProject(projectA);
        assertThat(listedA).hasSize(2);
        assertThat(listedA)
            .extracting(DbStructuralFindingDispositionDto::findingKey)
            .containsExactly(KEY_NO_PKS, KEY_NO_FKS);
        assertThat(listedA)
            .extracting(DbStructuralFindingDispositionDto::disposition)
            .containsExactly("accepted", "fix_upstream");

        List<DbStructuralFindingDispositionDto> listedB = service.listByProject(projectB);
        assertThat(listedB).hasSize(1);
        assertThat(listedB.get(0).disposition()).isEqualTo("known_gap");

        assertThat(service.listByProject(UUID.randomUUID())).isEmpty();
    }

    @Test
    @DisplayName("(e) delete un-dispositions (row removed); absent key -> ResourceNotFound (404 semantics)")
    void deleteRemovesAndMissingIs404() {
        UUID projectId = UUID.randomUUID();

        service.upsert(projectId, KEY_NO_PKS,
            req("accepted", "fine", "no_primary_keys", "all_tables"));
        entityManager.flush();

        service.delete(projectId, KEY_NO_PKS);
        entityManager.flush();
        entityManager.clear();
        assertThat(repository.findByProjectIdOrderByCreatedAtAsc(projectId)).isEmpty();

        // Deleting again (or any unknown key) collapses to 404 semantics.
        assertThatThrownBy(() -> service.delete(projectId, KEY_NO_PKS))
            .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.delete(projectId, "nope:nothing"))
            .isInstanceOf(ResourceNotFoundException.class);

        // Un-disposition then re-disposition: a FRESH row (new id) is fine.
        DbStructuralFindingDispositionDto recreated = service.upsert(
            projectId, KEY_NO_PKS,
            req("known_gap", "second thoughts", "no_primary_keys", "all_tables"));
        assertThat(recreated.id()).isNotNull();
        assertThat(recreated.updatedAt()).isNull();
    }
}
