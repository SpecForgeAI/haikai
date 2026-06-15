package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DbMigrationPackTranslationDto;
import com.example.architecturemodel.model.dto.UpdateDbMigrationPackTranslationRequest;
import com.example.architecturemodel.model.dto.UpsertDbMigrationPackTranslationsRequest;
import com.example.architecturemodel.model.dto.UpsertDbMigrationPackRequest;
import com.example.architecturemodel.model.dto.DbMigrationPackDto;
import com.example.architecturemodel.model.entity.DbMigrationPackTranslationEntity;
import com.example.architecturemodel.repository.entity.DbMigrationPackTranslationRepository;
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
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Focused service-layer tests for the DB migration pack TRANSLATIONS stack --
 * Spec 2 (LLM-Assisted DB Object Translation Drafts), Task Group 2,
 * sub-task 2.1 (4 of the 6 tests; the changeset-apply + file_kind CHECK
 * checks live in {@code DbMigrationPackTranslationChangesetTest}).
 *
 * <p>Same {@code @DataJpaTest} + H2 JSONB-domain-aliased setup as
 * {@link DbMigrationPackServiceTest}, with an {@code @Import} of both the
 * pack service (to create the owning pack) and the service-under-test.</p>
 *
 * <p>Coverage (per tasks.md 2.1):</p>
 * <ol>
 *   <li>(a) bulk-create translation rows + read-back round trip (snake_case
 *       wire, judge_verdict_json jsonb intact).</li>
 *   <li>(b) translation_key uniqueness per pack: upsert by key RE-LINKS
 *       (same id, draft/review preserved on sparse re-link) rather than
 *       duplicates; delete_absent removes manifest-dropped rows.</li>
 *   <li>(c) a sparse PATCH (review_status + reviewer_notes only) leaves
 *       pipeline_state, draft_content and the boxed fidelity flags untouched
 *       (null-guard check); drop requires a reason.</li>
 *   <li>(e) list-translations-for-pack returns ALL lifecycle fields for the
 *       coverage summary.</li>
 * </ol>
 *
 * <p>Spec: LLM-Assisted DB Object Translation Drafts (2026-06-11) --
 * Task Group 2.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:dbmigpacktranslationdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
@Import({DbMigrationPackService.class, DbMigrationPackTranslationService.class})
class DbMigrationPackTranslationServiceTest {

    @Autowired
    private DbMigrationPackService packService;

    @Autowired
    private DbMigrationPackTranslationService service;

    @Autowired
    private DbMigrationPackTranslationRepository translationRepository;

    @Autowired
    private TestEntityManager entityManager;

    // -----------------------------------------------------------------
    // Fixture builders
    // -----------------------------------------------------------------

    private DbMigrationPackDto createPack(UUID projectId) {
        return packService.upsertPack(projectId, new UpsertDbMigrationPackRequest(
            UUID.randomUUID(), null, null, "sha256:abc", null,
            10, 2, 3, 1000L, Map.of("requires_translation_spec_2", List.of()),
            null, null));
    }

    /** A seed-shaped row: identity + source body + fidelity flags only. */
    private static DbMigrationPackTranslationDto seedRow(
        String key, String kind, String objectRef, String body, String hash,
        Boolean truncated, Boolean legacyRedacted, String pipelineState) {
        return new DbMigrationPackTranslationDto(
            null, null, key, objectRef, kind,
            null, null, pipelineState,
            body, hash, truncated, legacyRedacted,
            null, null, null, null, null, null, null);
    }

    private static UpsertDbMigrationPackTranslationsRequest batch(
        Boolean deleteAbsent, DbMigrationPackTranslationDto... rows) {
        return new UpsertDbMigrationPackTranslationsRequest(List.of(rows), deleteAbsent);
    }

    // -----------------------------------------------------------------
    // Tests
    // -----------------------------------------------------------------

    @Test
    @DisplayName("(a) bulk create + read-back round trip: judge_verdict_json jsonb intact, snake_case wire")
    void bulkCreateAndReadBackRoundTrip() throws Exception {
        UUID projectId = UUID.randomUUID();
        DbMigrationPackDto pack = createPack(projectId);

        List<DbMigrationPackTranslationDto> created = service.upsertTranslations(
            projectId, pack.id(), batch(null,
                seedRow("stored_procedure--dbo.calc_tax", "stored_procedure", "dbo.calc_tax",
                    "CREATE PROCEDURE calc_tax AS ...", "sha256:p1", false, false, null),
                seedRow("trigger--dbo.trg_audit", "trigger", "dbo.trg_audit",
                    "CREATE TRIGGER trg_audit ...", "sha256:t1", false, true, null)));
        assertThat(created).hasSize(2);
        assertThat(created.get(0).id()).isNotNull();
        assertThat(created.get(0).packId()).isEqualTo(pack.id());
        // Entity defaults applied on insert.
        assertThat(created.get(0).disposition()).isEqualTo("translate");
        assertThat(created.get(0).pipelineState()).isEqualTo("pending");
        assertThat(created.get(0).reviewStatus()).isEqualTo("unreviewed");
        assertThat(created.get(1).legacyRedacted()).isTrue();

        // Persist a draft + verdict (the gateway's one-PATCH persist) and
        // reload: the jsonb verdict survives the round trip intact.
        DbMigrationPackTranslationDto drafted = service.updateTranslation(
            projectId, pack.id(), created.get(0).id(),
            new UpdateDbMigrationPackTranslationRequest(
                "drafted",
                "CREATE FUNCTION calc_tax() RETURNS void ...",
                Map.of(
                    "verdict", "equivalent",
                    "confidence", 0.9,
                    "flags", List.of(Map.of(
                        "construct", "@@rowcount",
                        "concern", "row-count semantics differ",
                        "severity", "medium"))),
                null, null, null, null));
        entityManager.flush();
        entityManager.clear();

        DbMigrationPackTranslationDto reloaded =
            service.getTranslation(projectId, pack.id(), drafted.id());
        assertThat(reloaded.pipelineState()).isEqualTo("drafted");
        assertThat(reloaded.draftContent()).contains("CREATE FUNCTION calc_tax()");
        assertThat(reloaded.translatedAt()).isNotNull();
        assertThat(reloaded.judgeVerdictJson()).containsEntry("verdict", "equivalent");
        assertThat(reloaded.judgeVerdictJson()).containsKey("flags");

        // Snake_case wire: a vanilla ObjectMapper honours the explicit
        // @JsonProperty declarations on the record.
        String json = new ObjectMapper().writeValueAsString(reloaded);
        assertThat(json).contains("\"translation_key\"");
        assertThat(json).contains("\"pipeline_state\"");
        assertThat(json).contains("\"judge_verdict_json\"");
        assertThat(json).contains("\"legacy_redacted\"");
        assertThat(json).contains("\"review_status\"");
        assertThat(json).doesNotContain("\"translationKey\"");
        assertThat(json).doesNotContain("\"pipelineState\"");
    }

    @Test
    @DisplayName("(b) upsert by translation_key re-links (same id, lifecycle preserved); delete_absent removes dropped objects")
    void upsertByKeyRelinksInsteadOfDuplicating() {
        UUID projectId = UUID.randomUUID();
        DbMigrationPackDto pack = createPack(projectId);
        String key = "view--dbo.v_orders";

        DbMigrationPackTranslationDto original = service.upsertTranslations(
            projectId, pack.id(), batch(null,
                seedRow(key, "view", "dbo.v_orders", "SELECT 1", "sha256:v1", false, false, null),
                seedRow("trigger--dbo.trg_gone", "trigger", "dbo.trg_gone",
                    "...", "sha256:g1", false, false, null)))
            .get(0);
        // Draft + approve the view so the re-link has lifecycle to preserve.
        service.updateTranslation(projectId, pack.id(), original.id(),
            new UpdateDbMigrationPackTranslationRequest(
                "drafted", "CREATE VIEW dbo.v_orders AS SELECT 1",
                Map.of("verdict", "equivalent", "confidence", 1.0, "flags", List.of()),
                null, null, null, null));
        service.updateTranslation(projectId, pack.id(), original.id(),
            new UpdateDbMigrationPackTranslationRequest(
                null, null, null, null, null, "approved", "looks right"));
        entityManager.flush();
        entityManager.clear();

        // Regeneration re-link: SAME key, unchanged-hash row arrives as a
        // SPARSE payload (identity + body + hash only -- draft/review fields
        // omitted); the dropped trigger is absent; a new proc appears.
        List<DbMigrationPackTranslationDto> relinked = service.upsertTranslations(
            projectId, pack.id(), batch(true,
                seedRow(key, "view", "dbo.v_orders", "SELECT 1", "sha256:v1", false, false, null),
                seedRow("stored_procedure--dbo.new_proc", "stored_procedure", "dbo.new_proc",
                    "CREATE PROC ...", "sha256:n1", false, false, null)));
        entityManager.flush();
        entityManager.clear();

        // Re-link, never duplicate: same id, lifecycle preserved verbatim.
        DbMigrationPackTranslationDto preserved = relinked.get(0);
        assertThat(preserved.id()).isEqualTo(original.id());
        assertThat(preserved.pipelineState()).isEqualTo("drafted");
        assertThat(preserved.draftContent()).contains("CREATE VIEW dbo.v_orders");
        assertThat(preserved.reviewStatus()).isEqualTo("approved");
        assertThat(preserved.reviewerNotes()).isEqualTo("looks right");
        assertThat(preserved.judgeVerdictJson()).containsEntry("verdict", "equivalent");

        // delete_absent removed the manifest-dropped trigger; the new proc
        // seeded as pending. Exactly two rows remain.
        List<DbMigrationPackTranslationEntity> rows =
            translationRepository.findByPackIdOrderByCreatedAtAsc(pack.id());
        assertThat(rows).hasSize(2);
        assertThat(rows).extracting(DbMigrationPackTranslationEntity::getTranslationKey)
            .containsExactlyInAnyOrder(key, "stored_procedure--dbo.new_proc");

        // Duplicate keys within one batch reject (uniqueness per pack).
        assertThatThrownBy(() -> service.upsertTranslations(
            projectId, pack.id(), batch(null,
                seedRow(key, "view", "dbo.v_orders", "x", "h", false, false, null),
                seedRow(key, "view", "dbo.v_orders", "y", "h2", false, false, null))))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("duplicate translation_key");
    }

    @Test
    @DisplayName("(c) sparse PATCH of review fields leaves pipeline_state, draft and boxed fidelity flags untouched; drop requires reason")
    void sparsePatchLeavesUntouchedFieldsAlone() {
        UUID projectId = UUID.randomUUID();
        DbMigrationPackDto pack = createPack(projectId);

        DbMigrationPackTranslationDto row = service.upsertTranslations(
            projectId, pack.id(), batch(null,
                seedRow("stored_procedure--dbo.calc", "stored_procedure", "dbo.calc",
                    "CREATE PROC calc ...", "sha256:c1", true, true, "needs_manual")))
            .get(0);
        service.updateTranslation(projectId, pack.id(), row.id(),
            new UpdateDbMigrationPackTranslationRequest(
                "drafted", "CREATE FUNCTION calc() ...",
                Map.of("verdict", "equivalent_with_concerns", "confidence", 0.7,
                    "flags", List.of()),
                null, null, null, null));
        entityManager.flush();
        entityManager.clear();

        // Sparse PATCH: ONLY review_status + reviewer_notes present.
        DbMigrationPackTranslationDto patched = service.updateTranslation(
            projectId, pack.id(), row.id(),
            new UpdateDbMigrationPackTranslationRequest(
                null, null, null, null, null, "needs_rework", "tighten NULL handling"));

        assertThat(patched.reviewStatus()).isEqualTo("needs_rework");
        assertThat(patched.reviewerNotes()).isEqualTo("tighten NULL handling");
        assertThat(patched.reviewedAt()).isNotNull();
        // Boxed-type/null-guard check: nothing else moved -- the pipeline
        // state, the draft, the verdict and the BOXED fidelity flags are all
        // untouched (no Boolean wiped to false by primitive defaulting).
        assertThat(patched.pipelineState()).isEqualTo("drafted");
        assertThat(patched.draftContent()).contains("CREATE FUNCTION calc()");
        assertThat(patched.judgeVerdictJson()).containsEntry("confidence", 0.7);
        assertThat(patched.truncated()).isTrue();
        assertThat(patched.legacyRedacted()).isTrue();
        assertThat(patched.sourceBody()).isEqualTo("CREATE PROC calc ...");
        assertThat(patched.sourceBodyHash()).isEqualTo("sha256:c1");

        // Returning to unreviewed (re-translate reset) clears reviewed_at.
        DbMigrationPackTranslationDto reset = service.updateTranslation(
            projectId, pack.id(), row.id(),
            new UpdateDbMigrationPackTranslationRequest(
                null, null, null, null, null, "unreviewed", null));
        assertThat(reset.reviewedAt()).isNull();
        assertThat(reset.reviewerNotes()).as("notes untouched by review reset")
            .isEqualTo("tighten NULL handling");

        // drop disposition without a reason rejects; with a reason persists.
        assertThatThrownBy(() -> service.updateTranslation(
            projectId, pack.id(), row.id(),
            new UpdateDbMigrationPackTranslationRequest(
                null, null, null, "drop", null, null, null)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("drop_reason is required");
        DbMigrationPackTranslationDto dropped = service.updateTranslation(
            projectId, pack.id(), row.id(),
            new UpdateDbMigrationPackTranslationRequest(
                null, null, null, "drop", "replaced by app-side report", null, null));
        assertThat(dropped.disposition()).isEqualTo("drop");
        assertThat(dropped.dropReason()).isEqualTo("replaced by app-side report");

        // Invalid enum value on PATCH rejects.
        assertThatThrownBy(() -> service.updateTranslation(
            projectId, pack.id(), row.id(),
            new UpdateDbMigrationPackTranslationRequest(
                "not-a-state", null, null, null, null, null, null)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid pipeline_state");
    }

    @Test
    @DisplayName("(e) list-translations-for-pack returns all lifecycle fields for the coverage summary")
    void listReturnsAllLifecycleFieldsForCoverageSummary() {
        UUID projectId = UUID.randomUUID();
        DbMigrationPackDto pack = createPack(projectId);

        service.upsertTranslations(projectId, pack.id(), batch(null,
            seedRow("stored_procedure--dbo.p1", "stored_procedure", "dbo.p1",
                "BODY1", "sha256:1", false, false, null),
            seedRow("trigger--dbo.t1", "trigger", "dbo.t1",
                "BODY2", "sha256:2", true, false, "needs_manual"),
            seedRow("view--dbo.v1", "view", "dbo.v1",
                "BODY3", "sha256:3", false, true, "failed")));
        // One object dispositioned away (rewrite-in-app).
        List<DbMigrationPackTranslationDto> all =
            service.listTranslations(projectId, pack.id());
        service.updateTranslation(projectId, pack.id(), all.get(0).id(),
            new UpdateDbMigrationPackTranslationRequest(
                null, null, null, "rewrite_in_app", null, null, null));
        entityManager.flush();
        entityManager.clear();

        List<DbMigrationPackTranslationDto> listed =
            service.listTranslations(projectId, pack.id());
        assertThat(listed).hasSize(3);
        // Every bucket-relevant lifecycle field is present per row: the
        // gateway's coverage ledger (exactly-one-bucket assertion) reads
        // kind + disposition + pipeline_state + review_status + fidelity.
        assertThat(listed).extracting(DbMigrationPackTranslationDto::translationKey)
            .containsExactly("stored_procedure--dbo.p1", "trigger--dbo.t1", "view--dbo.v1");
        assertThat(listed).extracting(DbMigrationPackTranslationDto::disposition)
            .containsExactly("rewrite_in_app", "translate", "translate");
        assertThat(listed).extracting(DbMigrationPackTranslationDto::pipelineState)
            .containsExactly("pending", "needs_manual", "failed");
        assertThat(listed).extracting(DbMigrationPackTranslationDto::reviewStatus)
            .containsExactly("unreviewed", "unreviewed", "unreviewed");
        assertThat(listed.get(1).truncated()).isTrue();
        assertThat(listed.get(2).legacyRedacted()).isTrue();
        assertThat(listed).allSatisfy(t -> {
            assertThat(t.kind()).isNotNull();
            assertThat(t.sourceBodyHash()).isNotNull();
            assertThat(t.createdAt()).isNotNull();
        });

        // Unknown pack collapses to 404 semantics on the read surface.
        assertThatThrownBy(() -> service.listTranslations(projectId, UUID.randomUUID()))
            .isInstanceOf(com.example.architecturemodel.exception.ResourceNotFoundException.class);
    }
}
